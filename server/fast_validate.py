"""Local-only Fast Validate service for unsaved Team A/C dbt models.

WARNING: dbt executes project Jinja/macros in Python. This development server
MUST NOT be exposed to untrusted users or public networks. Production requires
authenticated, sandboxed workers with network/filesystem restrictions.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from . import team_portal, dbt_cloud, project_connections

HOST = "127.0.0.1"
PORT = int(os.environ.get("FAST_VALIDATE_PORT", "8765"))
IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]*$")
TEAMS = {"team-a": "team_a", "team-c": "team_c"}
GOVERNANCE_URL = "https://github.com/robin-bajaj/cdo-semantic-governance.git"
MAX_BODY = 128 * 1024
MAX_OUTPUT = 12000
SLOTS = threading.BoundedSemaphore(2)
PROFILE = """default:
  target: ci
  outputs:
    ci:
      type: postgres
      host: localhost
      port: 5432
      user: ci
      password: ci
      dbname: ci
      schema: ci
      threads: 1
"""


class InputError(Exception):
    pass


class StepFailure(Exception):
    def __init__(self, step: str, output: str):
        super().__init__(step)
        self.step, self.output = step, output


def validate_payload(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise InputError("Expected JSON object")
    role = payload.get("role")
    team = TEAMS.get(role)
    if not team:
        raise InputError("Only Team A and Team C models can be validated")
    source = payload.get("sourceModel")
    stage_only = payload.get("validationScope") == "staging"
    semantic = payload.get("semanticName")
    mode = payload.get("sourceMode")
    identifiers = (source,) if stage_only else (source, semantic)
    if not all(isinstance(x, str) and IDENTIFIER.fullmatch(x) for x in identifiers):
        raise InputError("Invalid source or semantic model identifier")
    if mode not in ("new", "existing"):
        raise InputError("Invalid source model mode")
    yaml_text = payload.get("yamlText")
    sql = payload.get("sourceSql")
    if not stage_only and (not isinstance(yaml_text, str) or not yaml_text.strip() or len(yaml_text) > 80_000):
        raise InputError("Missing or oversized semantic YAML")
    if mode == "new" and (not isinstance(sql, str) or not sql.strip() or len(sql) > 40_000):
        raise InputError("New staging SQL is required (maximum 40 KB)")
    if mode == "existing" and sql is not None:
        raise InputError("Existing source model must be loaded from the repository")
    if not stage_only:
        try:
            import yaml
            parsed = yaml.safe_load(yaml_text)
        except Exception as exc:
            raise InputError(f"Invalid YAML: {exc}") from exc
        models = parsed.get("models") if isinstance(parsed, dict) else None
        if (not isinstance(models, list) or len(models) != 1 or
                not isinstance(models[0], dict) or models[0].get("name") != source or
                (models[0].get("semantic_model") or {}).get("name") != semantic):
            raise InputError("YAML must define exactly the selected source and semantic model")
    return {
        "team": team, "source": source, "semantic": semantic, "mode": mode,
        "yaml": None if stage_only else yaml_text, "sql": sql if mode == "new" else None,
        "stage_only": stage_only,
    }


def run_command(step: str, argv: list[str], cwd: Path, env: dict | None = None, timeout: int = 65) -> str:
    try:
        process = subprocess.run(
            argv, cwd=cwd, env=env, capture_output=True, text=True,
            timeout=timeout, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise StepFailure(step, f"Timed out after {timeout}s") from exc
    except OSError as exc:
        raise StepFailure(step, f"Unable to launch command: {exc}") from exc
    output = ((process.stdout or "") + "\n" + (process.stderr or "")).strip()
    if process.returncode:
        raise StepFailure(step, output[-MAX_OUTPUT:] or f"Exit status {process.returncode}")
    return output[-MAX_OUTPUT:]



def check_staging_sql(sql: str) -> None:
    """Fast PostgreSQL syntax check before cloning. Jinja-enabled SQL is checked by dbt."""
    if re.match(r"(?is)^\s*select\s+from\b", sql):
        raise InputError("Staging SQL syntax error: SELECT must have an expression before FROM.")
    if "{{" in sql or "{%" in sql or "{#" in sql:
        return  # SQLGlot cannot safely interpret dbt Jinja without compilation.
    try:
        import sqlglot
        from sqlglot import exp
        statements = sqlglot.parse(sql, read="postgres", error_level="RAISE")
        if len(statements) != 1 or not isinstance(statements[0], (exp.Select, exp.Union, exp.Intersect, exp.Except)):
            raise InputError("Staging SQL must contain a single SELECT query.")
        # sqlglot may tolerate malformed/trailing bare identifiers, which are not useful dbt models.
        if not sql.strip():
            raise InputError("Enter staging SQL.")
    except InputError:
        raise
    except Exception as exc:
        raise InputError(f"Staging SQL syntax error: {exc}") from exc


def validate_dbt(payload: object, *, runner=run_command) -> dict:
    """Overlay unsaved edits on a snapshot of the managed project and parse with dbt."""
    data = validate_payload(payload)
    steps: list[dict] = []
    if data["stage_only"] and data["mode"] == "new":
        try:
            check_staging_sql(data["sql"])
        except InputError as exc:
            return {"ok": False, "steps": [{"name": "SQL syntax", "status": "failed"}],
                    "error": str(exc), "log": str(exc), "mode": "parse-only", "scope": "staging"}
        steps.append({"name": "SQL syntax", "status": "passed"})
    with tempfile.TemporaryDirectory(prefix="cdo-dbt-validate-") as dirname:
        root = Path(dirname)
        project, gov = root / "project", root / "governance"
        try:
            source = team_portal.project_path()
            if not (source / "dbt_project.yml").is_file():
                raise InputError("Model workspace could not initialize; contact the administrator")
            # Team models live in our managed project; never pull from federated-semantic-poc.
            shutil.copytree(source, project, ignore=shutil.ignore_patterns(".git", "target", "logs", ".venv", ".portal"))
            steps.append({"name": "Load model workspace", "status": "passed"})
            yaml_path = (project / "models" / "semantic_models" / data["team"] / (data["semantic"] + ".yml")) if not data["stage_only"] else None
            sql_path = project / "models" / "staging" / data["team"] / (data["source"] + ".sql")
            if not data["stage_only"] and yaml_path.exists():
                raise InputError(f"{yaml_path.name} already exists in the workspace; choose another semantic model name")
            if data["mode"] == "new":
                if sql_path.exists():
                    raise InputError(f"{sql_path.name} already exists in the workspace; choose another model name")
                sql_path.parent.mkdir(parents=True, exist_ok=True)
                sql_path.write_text(data["sql"], encoding="utf-8")
            elif not sql_path.is_file():
                raise InputError(f"Existing source model {data['source']} is not in this team's staging folder")
            if not data["stage_only"]:
                yaml_path.parent.mkdir(parents=True, exist_ok=True)
                yaml_path.write_text(data["yaml"], encoding="utf-8")
            profiles = project / ".ci"
            profiles.mkdir(exist_ok=True)
            (profiles / "profiles.yml").write_text(PROFILE, encoding="utf-8")
            steps.append({"name": "Apply unsaved staging SQL" if data["stage_only"] else "Apply unsaved SQL and semantic YAML", "status": "passed"})
            env = os.environ.copy()
            # Resolve custom CDO inheritance only when the authored model opts in.
            # The dbt deployment receives the compiled, native YAML.
            if not data["stage_only"]:
                import yaml
                model = yaml.safe_load(data["yaml"])["models"][0]
                meta = (model.get("config") or {}).get("meta") or {}
                if "uses" in meta or "cdo" in meta or "semantic_inheritance" in meta:
                    # Local path is only an optional performance hint. If it
                    # points to an old/moved folder, transparently fetch the
                    # approved governance registry instead of blocking a team.
                    configured = os.environ.get("CDO_GOVERNANCE_PATH", "").strip()
                    local_gov = Path(configured).expanduser().resolve() if configured else None
                    if local_gov and (local_gov / "contracts").is_dir() and (local_gov / "src").is_dir():
                        gov = local_gov
                    else:
                        runner("Load approved CDO contracts",
                               ["git", "clone", "--quiet", "--depth", "1", "--branch", "main",
                                GOVERNANCE_URL, str(gov)], root, timeout=45)
                    steps.append({"name": "Load approved CDO contracts", "status": "passed"})
                    env["PYTHONPATH"] = str(gov / "src") + os.pathsep + env.get("PYTHONPATH", "")
                    runner("CDO registry validation",
                           [shutil.which("python3") or "python3", "-m", "cdo_governance.semantic.contract_registry",
                            "--registry", str(gov / "contracts")], project, env=env)
                    steps.append({"name": "CDO registry validation", "status": "passed"})
                    runner("CDO inheritance compiler",
                           [shutil.which("python3") or "python3", "-m", "cdo_governance.semantic.semantic_compiler",
                            "--registry", str(gov / "contracts"), "--project", str(project),
                            "--bindings-output", str(profiles / "cdo-resolved-bindings.yml")], project, env=env)
                    steps.append({"name": "CDO inheritance compiler", "status": "passed"})
            # Match the actual profile specified in dbt_project.yml.
            import yaml
            project_settings = yaml.safe_load((project / "dbt_project.yml").read_text(encoding="utf-8")) or {}
            profile_name = project_settings.get("profile") or project_settings.get("name") or "default"
            if not isinstance(profile_name, str) or not re.fullmatch(r"[a-zA-Z_][a-zA-Z_0-9-]*", profile_name):
                raise InputError("Invalid dbt profile identifier")
            (profiles / "profiles.yml").write_text(
                PROFILE.replace("default:", f"{profile_name}:", 1), encoding="utf-8")
            # A dummy profile is sufficient for parsing without a warehouse connection.
            dbt = shutil.which("dbt")
            if not dbt:
                raise StepFailure("dbt Core parse", "dbt command not found; install backend requirements")
            output = runner("dbt Core parse",
                            [dbt, "parse", "--profiles-dir", str(profiles), "--no-partial-parse"],
                            project, env=env, timeout=90)
            steps.append({"name": "dbt Core parse", "status": "passed"})
            if not (project / "target" / "manifest.json").is_file():
                raise StepFailure("dbt Core parse", "dbt parse completed without a manifest.json")
            return {"ok": True, "steps": steps, "log": output, "mode": "parse-only",
                    "scope": "staging" if data["stage_only"] else "full-draft",
                    "compiledYaml": yaml_path.read_text(encoding="utf-8") if yaml_path else None}
        except StepFailure as exc:
            steps.append({"name": exc.step, "status": "failed"})
            # dbt's raw compilation trace is useful to developers, but the
            # model author needs an actionable message without reading logs.
            missing = re.search(
                r"""depends on a node named ['"]([A-Za-z_][A-Za-z_0-9]*)['"] which was not found""",
                re.sub(r"\x1b\[[0-9;]*m", "", exc.output),
                flags=re.IGNORECASE,
            )
            if exc.step == "dbt Core parse" and missing:
                name = missing.group(1)
                return {
                    "ok": False, "steps": steps, "log": exc.output,
                    "error": f"Referenced model '{name}' does not exist in this workspace.",
                    "hint": "Use a model already published in this portal, or write standalone staging SQL without ref(). Models in the paused federated project are not available here.",
                    "mode": "parse-only",
                }
            return {"ok": False, "steps": steps, "log": exc.output,
                    "error": f"{exc.step} failed", "mode": "parse-only"}
        except InputError as exc:
            steps.append({"name": "Validate source files", "status": "failed"})
            return {"ok": False, "steps": steps, "log": str(exc), "error": str(exc), "mode": "parse-only"}


ONBOARDING_PATHS = frozenset({
    "/api/lead/dbt/projects", "/api/lead/dbt/preview", "/api/lead/dbt/connect",
    "/api/lead/github/connect", "/api/lead/github/disconnect",
    "/api/team-models/publish",
})


def local_onboarding_request_allowed(client_ip: str, host: str, origin: str | None) -> bool:
    """Localhost POC guard, not production authentication.

    Vite forwards Host unchanged from localhost:5173, while clients that
    call Python directly use localhost:8765. Never accept remote clients,
    DNS-rebound Host values, or foreign web origins when receiving a dbt token.
    """
    if client_ip not in ("127.0.0.1", "::1"):
        return False
    hosts = {"localhost:5173", "127.0.0.1:5173",
             f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
    if host not in hosts:
        return False
    if origin is not None and origin not in ("http://localhost:5173", "http://127.0.0.1:5173",
                                               f"http://localhost:{PORT}", f"http://127.0.0.1:{PORT}"):
        return False
    return True


class Handler(BaseHTTPRequestHandler):
    """Loopback-only POC gateway: portal drafts, dbt Core, dbt Cloud metadata."""

    def do_POST(self):
        path = urlparse(self.path).path
        allowed = {"/api/validate/fast", "/api/validate/staging",
                   "/api/team-models/save", "/api/team-models/delete", "/api/team-models/validate",
                   "/api/team-models/publish", "/api/dbt/jobs/run",
                   "/api/lead/dbt/projects",
                   "/api/lead/dbt/preview", "/api/lead/dbt/connect",
                   "/api/lead/github/connect", "/api/lead/github/disconnect"}
        if path not in allowed:
            self.send_error(404)
            return
        if path in ONBOARDING_PATHS and not local_onboarding_request_allowed(
            self.client_address[0], self.headers.get("Host", ""), self.headers.get("Origin")
        ):
            self.send_json(403, {"ok": False, "error": "dbt onboarding is available only from the local portal"})
            return
        try:
            count = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            count = 0
        if count <= 0 or count > MAX_BODY:
            self.send_json(413, {"ok": False, "error": "Invalid request size"})
            return
        try:
            payload = json.loads(self.rfile.read(count))
            if not isinstance(payload, dict):
                raise ValueError("Expected JSON object")
        except (ValueError, UnicodeError):
            self.send_json(400, {"ok": False, "error": "Invalid JSON"})
            return
        validation = path in ("/api/validate/fast", "/api/validate/staging", "/api/team-models/validate")
        if validation and not SLOTS.acquire(blocking=False):
            self.send_json(429, {"ok": False, "error": "Validation busy; retry shortly"})
            return
        try:
            if path == "/api/lead/github/connect":
                self.send_json(200, {"ok": True, **project_connections.connect_github_token(payload.get("role"), payload.get("token"))})
            elif path == "/api/lead/github/disconnect":
                self.send_json(200, {"ok": True, **project_connections.disconnect_github_token(payload.get("role"))})
            elif path == "/api/lead/dbt/projects":
                result = project_connections.preview_account(
                    payload.get("role"), payload)
                self.send_json(200, {"ok": True, **result})
            elif path == "/api/lead/dbt/preview":
                project = project_connections.preview_project(
                    payload.get("role"), payload)
                self.send_json(200, {"ok": True, "project": project})
            elif path == "/api/lead/dbt/connect":
                connection = project_connections.assign(
                    payload.get("role"), payload)
                self.send_json(200, {"ok": True, "connection": connection})
            elif path == "/api/team-models/save":
                self.send_json(200, {"ok": True, "draft": team_portal.save_draft(payload)})
            elif path == "/api/team-models/delete":
                team_portal.delete_draft(payload.get("id", ""), payload.get("role", ""))
                self.send_json(200, {"ok": True})
            elif path == "/api/team-models/publish":
                result = team_portal.publish_draft(payload.get("id", ""))
                self.send_json(200, {"ok": True, **result})
            elif path == "/api/team-models/validate":
                draft = team_portal.load_draft(payload.get("id", ""))
                data = team_portal.validate_input(draft)
                result = validate_dbt(data)
                if result.get("ok"):
                    result["draft"] = team_portal.mark_validated(draft["id"], result)
                self.send_json(200 if result["ok"] else 422, result)
            elif path in ("/api/validate/fast", "/api/validate/staging"):
                if path == "/api/validate/staging":
                    payload["validationScope"] = "staging"
                result = validate_dbt(payload)
                self.send_json(200 if result["ok"] else 422, result)
            elif path == "/api/dbt/jobs/run":
                if os.environ.get("DBT_CLOUD_ENABLE_RUNS") != "1":
                    raise team_portal.PortalError("Remote job triggers are disabled; set DBT_CLOUD_ENABLE_RUNS=1 explicitly", 403)
                self.send_json(200, {"ok": True, "remote": True,
                                     "result": dbt_cloud.trigger_configured_job()})
        except team_portal.PortalError as exc:
            self.send_json(exc.status, {"ok": False, "error": str(exc)})
        except InputError as exc:
            self.send_json(400, {"ok": False, "error": str(exc)})
        except dbt_cloud.DbtCloudError as exc:
            self.send_json(502, {"ok": False, "error": str(exc)})
        except Exception:
            self.send_json(500, {"ok": False, "error": "Backend operation failed"})
        finally:
            if validation:
                SLOTS.release()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            if path == "/api/health":
                self.send_json(200, {"status": "ready", "engine": "dbt-core",
                                     "workspaceReady": (team_portal.project_path() / "dbt_project.yml").is_file()})
            elif path == "/api/dbt/status":
                project = team_portal.project_path()
                self.send_json(200, {
                    "workspaceReady": (project / "dbt_project.yml").is_file(),
                    "validationReady": bool(shutil.which("dbt")),
                    "publishingMode": "portal-managed-local",
                    # Backwards-compatible fields for existing dashboard clients.
                    "dbtCoreAvailable": bool(shutil.which("dbt")),
                    "localProjectConfigured": True,
                    "remoteAdminConfigured": dbt_cloud.configured(),
                    "projectConnectionAvailable": dbt_cloud.configured(),
                    "remoteRunsEnabled": os.environ.get("DBT_CLOUD_ENABLE_RUNS") == "1",
                })
            elif path == "/api/lead/github/status":
                role = parse_qs(parsed.query).get("role", [""])[0]
                self.send_json(200, {"ok": True, **project_connections.github_connection_status(role)})
            elif path == "/api/team-models/connected":
                role = parse_qs(parsed.query).get("role", [""])[0]
                self.send_json(200, project_connections.inventory(role))
            elif path == "/api/team-models/file":
                query = parse_qs(parsed.query)
                role = query.get("role", [""])[0]
                file_path = query.get("path", [""])[0]
                self.send_json(200, project_connections.model_file(role, file_path))
            elif path == "/api/team-models":
                role = parse_qs(parsed.query).get("role", [""])[0]
                self.send_json(200, {"models": team_portal.list_drafts(role)})
            elif path == "/api/team-models/sources":
                role = parse_qs(parsed.query).get("role", [""])[0]
                self.send_json(200, {"sources": team_portal.source_models(role)})
            elif path == "/api/dbt/jobs":
                self.send_json(200, {"ok": True, "result": dbt_cloud.jobs()})
            elif path.startswith("/api/dbt/runs/"):
                self.send_json(200, {"ok": True, "result": dbt_cloud.run_status(path.rsplit("/", 1)[-1])})
            else:
                self.send_error(404)
        except team_portal.PortalError as exc:
            self.send_json(exc.status, {"ok": False, "error": str(exc)})
        except dbt_cloud.DbtCloudError as exc:
            self.send_json(502, {"ok": False, "error": str(exc)})
        except Exception:
            self.send_json(500, {"ok": False, "error": "Backend operation failed"})

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Never log submitted SQL/YAML or access tokens.
        return


def main():
    # Provision once when the local backend starts; subsequent calls are
    # idempotent. Users never need to create or configure a dbt project.
    project = team_portal.project_path()
    print(f"Semantic portal backend at http://{HOST}:{PORT} (managed project: {project})", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()

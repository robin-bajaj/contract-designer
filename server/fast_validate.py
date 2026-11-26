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

HOST = "127.0.0.1"
PORT = int(os.environ.get("FAST_VALIDATE_PORT", "8765"))
IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]*$")
TEAMS = {"team-a": "team_a", "team-c": "team_c"}
FEDERATED_URL = "https://github.com/robin-bajaj/federated-semantic-poc.git"
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


def validate_dbt(payload: object, *, runner=run_command) -> dict:
    """Checkout, overlay unsaved edits, compile CDO, parse with dbt Core. Never commit."""
    data = validate_payload(payload)
    steps: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="cdo-dbt-validate-") as dirname:
        root = Path(dirname)
        project, gov = root / "project", root / "governance"
        try:
            runner("Checkout dbt project", ["git", "clone", "--quiet", "--depth", "1", "--branch", "main",
                                           FEDERATED_URL, str(project)], root, timeout=45)
            runner("Checkout CDO registry", ["git", "clone", "--quiet", "--depth", "1", "--branch", "main",
                                            GOVERNANCE_URL, str(gov)], root, timeout=45)
            steps.append({"name": "Load GitHub project and CDO registry", "status": "passed"})
            yaml_path = (project / "models" / "semantic_models" / data["team"] / (data["semantic"] + ".yml")) if not data["stage_only"] else None
            sql_path = project / "models" / "staging" / data["team"] / (data["source"] + ".sql")
            if not data["stage_only"] and yaml_path.exists():
                raise InputError(f"{yaml_path.name} already exists on main; create a new semantic model name")
            if data["mode"] == "new":
                if sql_path.exists():
                    raise InputError(f"{sql_path.name} already exists on main; choose another model name")
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
                    "scope": "staging" if data["stage_only"] else "full-draft"}
        except StepFailure as exc:
            steps.append({"name": exc.step, "status": "failed"})
            return {"ok": False, "steps": steps, "log": exc.output, "error": f"{exc.step} failed", "mode": "parse-only"}
        except InputError as exc:
            steps.append({"name": "Validate source files", "status": "failed"})
            return {"ok": False, "steps": steps, "log": str(exc), "error": str(exc), "mode": "parse-only"}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path not in ("/api/validate/fast", "/api/validate/staging"):
            self.send_error(404)
            return
        try:
            count = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            count = 0
        if count <= 0 or count > MAX_BODY:
            self.send_error(413, "Invalid request size")
            return
        try:
            payload = json.loads(self.rfile.read(count))
            if self.path == "/api/validate/staging":
                if not isinstance(payload, dict):
                    raise ValueError("Expected object")
                payload["validationScope"] = "staging"
        except (ValueError, UnicodeError):
            self.send_error(400, "Invalid JSON")
            return
        if not SLOTS.acquire(blocking=False):
            self.send_json(429, {"ok": False, "error": "Validation service busy; retry shortly"})
            return
        try:
            try:
                result = validate_dbt(payload)
                self.send_json(200 if result["ok"] else 422, result)
            except InputError as exc:
                self.send_json(400, {"ok": False, "error": str(exc), "steps": []})
            except Exception:
                self.send_json(500, {"ok": False, "error": "Backend validation failed unexpectedly", "steps": []})
        finally:
            SLOTS.release()

    def do_GET(self):
        if self.path == "/api/health":
            self.send_json(200, {"status": "ready", "engine": "dbt-core"})
        else:
            self.send_error(404)

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Never log submitted SQL/YAML or tokens.
        return


def main():
    print(f"Fast Validate development backend at http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()

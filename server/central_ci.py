"""CDO-owned, team-neutral GitHub PR validation runner.

Runs only in an isolated, disposable worker with an explicitly configured
validation warehouse. dbt models and Jinja are arbitrary code: production
deployments MUST use sandboxed worker containers, not the API host.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import shutil
import tempfile

import yaml

from . import project_snapshot, project_connections, team_ids, team_portal
from .fast_validate import run_command, StepFailure

GOVERNANCE_URL = "https://github.com/robin-bajaj/cdo-semantic-governance.git"
MAX_LOG = 12000
SHA = re.compile(r"^[a-f0-9]{40}$")


def candidate_role(repository: str, branch: str) -> str | None:
    """Resolve a PR to its team's registered project, never from PR YAML."""
    with project_connections.connect() as db:
        rows = db.execute(
            "SELECT role, repository FROM project_connections WHERE lower(repository)=lower(?)",
            (repository,),
        ).fetchall()
    matches = [row["role"] for row in rows
               if team_ids.is_team(row["role"])
               and branch.startswith("portal/" + team_ids.folder(row["role"]) + "/")]
    return matches[0] if len(matches) == 1 else None


def ci_environment(role: str, source: dict | None = None) -> dict:
    """Use platform-owned scoped secrets; never store warehouse passwords in Git."""
    source = source or os.environ
    prefix = "CENTRAL_CI_" + team_ids.folder(role).upper() + "_"
    required = ("HOST", "USER", "PASSWORD", "DBNAME")
    missing = [key for key in required if not source.get(prefix + "PG_" + key)]
    if missing:
        raise StepFailure(
            "Warehouse configuration",
            "Missing platform-managed validation credentials for this team's warehouse: " +
            ", ".join(missing) + ". No database-backed validation was performed.",
        )
    return {
        "DBT_PG_HOST": source[prefix + "PG_HOST"],
        "DBT_PG_USER": source[prefix + "PG_USER"],
        "DBT_PG_PASSWORD": source[prefix + "PG_PASSWORD"],
        "DBT_PG_DBNAME": source[prefix + "PG_DBNAME"],
        "DBT_PG_PORT": source.get(prefix + "PG_PORT", "5432"),
    }


def profile(project: Path, role: str, sha: str, env: dict) -> Path:
    settings = yaml.safe_load((project / "dbt_project.yml").read_text()) or {}
    name = settings.get("profile") or settings.get("name")
    if not isinstance(name, str) or not re.fullmatch(r"[a-zA-Z_][a-zA-Z_0-9-]*", name):
        raise StepFailure("dbt profile", "Connected dbt project has no valid profile name")
    folder = project / ".central-ci"
    folder.mkdir(exist_ok=True)
    # No passwords are written to the workspace; dbt reads env vars at runtime.
    doc = """{name}:
  target: ci
  outputs:
    ci:
      type: postgres
      host: "{{{{ env_var('DBT_PG_HOST') }}}}"
      port: "{{{{ env_var('DBT_PG_PORT') | int }}}}"
      user: "{{{{ env_var('DBT_PG_USER') }}}}"
      password: "{{{{ env_var('DBT_PG_PASSWORD') }}}}"
      dbname: "{{{{ env_var('DBT_PG_DBNAME') }}}}"
      schema: "{schema}"
      sslmode: require
      threads: 2
""".format(name=name, schema="ci_" + team_ids.folder(role)[:28] + "_" + sha[:12])
    (folder / "profiles.yml").write_text(doc)
    return folder


def validate_pr(role: str, repository: str, sha: str, *, runner=run_command,
                snapshot=project_snapshot.snapshot, credentials=ci_environment) -> dict:
    """Fail closed. Parse + warehouse-backed dbt build are both mandatory."""
    steps = []
    if not team_ids.is_team(role) or not SHA.fullmatch(sha):
        return {"ok": False, "error": "Invalid team or commit", "steps": steps}
    connection = project_connections.connection_for(role)
    if not connection or connection["repository"].lower() != repository.lower():
        return {"ok": False, "error": "PR is not from the team's connected repository", "steps": steps}
    with tempfile.TemporaryDirectory(prefix="central-dbt-pr-") as dirname:
        root = Path(dirname)
        project, governance = root / "project", root / "governance"
        try:
            info = snapshot(role, project, commit_sha=sha)
            if info["revision"] != sha:
                raise StepFailure("Checkout PR", "Validated checkout differs from PR SHA")
            steps.append({"name": "Checkout exact PR commit", "status": "passed"})
            env = {**os.environ, **credentials(role)}
            # All teams use the same approved compiler. Source Git files stay authored.
            local = os.environ.get("CDO_GOVERNANCE_PATH", "").strip()
            gov_path = Path(local).expanduser().resolve() if local else None
            if gov_path and (gov_path / "src").is_dir() and (gov_path / "contracts").is_dir():
                governance = gov_path
            else:
                runner("Load CDO governance",
                       ["git", "clone", "--quiet", "--depth", "1", "--branch", "main",
                        GOVERNANCE_URL, str(governance)], root, timeout=90)
            steps.append({"name": "Load CDO governance", "status": "passed"})
            env["PYTHONPATH"] = str(governance / "src") + os.pathsep + env.get("PYTHONPATH", "")
            python = shutil.which("python3") or "python3"
            runner("Validate contract registry",
                   [python, "-m", "cdo_governance.semantic.contract_registry",
                    "--registry", str(governance / "contracts")], project, env=env)
            steps.append({"name": "Validate contract registry", "status": "passed"})
            runner("Compile CDO inheritance",
                   [python, "-m", "cdo_governance.semantic.semantic_compiler",
                    "--registry", str(governance / "contracts"), "--project", str(project),
                    "--bindings-output", str(project / ".central-bindings.yml")],
                   project, env=env)
            steps.append({"name": "Compile CDO inheritance", "status": "passed"})
            profiles = profile(project, role, sha, env)
            dbt = shutil.which("dbt")
            if not dbt:
                raise StepFailure("dbt Core", "dbt executable is missing from central validation worker")
            if (project / "packages.yml").exists() or (project / "dependencies.yml").exists():
                runner("dbt deps", [dbt, "deps", "--profiles-dir", str(profiles)],
                       project, env=env, timeout=120)
                steps.append({"name": "dbt deps", "status": "passed"})
            runner("dbt parse",
                   [dbt, "parse", "--profiles-dir", str(profiles), "--no-partial-parse"],
                   project, env=env, timeout=120)
            if not (project / "target" / "manifest.json").is_file():
                raise StepFailure("dbt parse", "dbt did not produce manifest.json")
            steps.append({"name": "dbt parse", "status": "passed"})
            output = runner("dbt build",
                            [dbt, "build", "--profiles-dir", str(profiles), "--full-refresh"],
                            project, env=env, timeout=900)
            steps.append({"name": "dbt build", "status": "passed"})
            return {"ok": True, "repository": repository, "sha": sha, "steps": steps,
                    "summary": "CDO compilation, dbt parse and database-backed dbt build passed.",
                    "log": output[-MAX_LOG:]}
        except (StepFailure, team_portal.PortalError, OSError, ValueError) as exc:
            name = exc.step if isinstance(exc, StepFailure) else "Project validation"
            detail = exc.output if isinstance(exc, StepFailure) else str(exc)
            steps.append({"name": name, "status": "failed"})
            return {"ok": False, "repository": repository, "sha": sha, "steps": steps,
                    "error": f"{name}: {detail[-MAX_LOG:]}"}

"""Administrator-controlled dbt project connections and read-only Git inventory.

Team A/C developers never supply dbt, warehouse or GitHub credentials.
The dbt API and GitHub credentials live in Python's environment. A separate
administrator key gates all connection configuration endpoints; selecting a
CDO role in the demo frontend is NOT an authorization mechanism.
"""
from __future__ import annotations

import base64
import hmac
import json
import os
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import yaml
from . import dbt_cloud, team_portal

TEAM_PREFIX = {"team-a": "team_a", "team-c": "team_c"}
GITHUB_REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
SEGMENT = re.compile(r"^[A-Za-z0-9_.-]+$")
MAX_INVENTORY_FILES = 60
MAX_FILE_BYTES = 100_000


def require_admin(header: str | None) -> None:
    expected = os.environ.get("PORTAL_ADMIN_KEY", "")
    if not expected:
        raise team_portal.PortalError("Administrator access is not configured on this backend", 503)
    if not isinstance(header, str) or not hmac.compare_digest(header, expected):
        raise team_portal.PortalError("Administrator authorization required", 403)


def connect():
    connection = team_portal.connect()
    connection.execute("""CREATE TABLE IF NOT EXISTS project_connections (
        role TEXT PRIMARY KEY,
        project_id INTEGER NOT NULL,
        project_name TEXT NOT NULL,
        environment_id INTEGER,
        environment_name TEXT NOT NULL,
        repository TEXT NOT NULL,
        branch TEXT NOT NULL,
        subdirectory TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""")
    return connection


def _clean(row) -> dict | None:
    if row is None:
        return None
    return {
        "role": row["role"], "projectId": row["project_id"],
        "projectName": row["project_name"],
        "environmentId": row["environment_id"],
        "environmentName": row["environment_name"],
        "repository": row["repository"], "branch": row["branch"],
        "subdirectory": row["subdirectory"],
        "updatedAt": row["updated_at"],
    }


def connection_for(role: str) -> dict | None:
    if role not in TEAM_PREFIX:
        raise team_portal.PortalError("Unknown team", 400)
    with connect() as db:
        row = db.execute("SELECT * FROM project_connections WHERE role=?", (role,)).fetchone()
    return _clean(row)


def all_connections() -> list[dict]:
    with connect() as db:
        rows = db.execute("SELECT * FROM project_connections ORDER BY role").fetchall()
    return [_clean(row) for row in rows]


def _items(response: dict, label: str) -> list[dict]:
    entries = response.get("data") if isinstance(response, dict) else None
    if not isinstance(entries, list):
        raise dbt_cloud.DbtCloudError(f"Unexpected dbt {label} response")
    return [item for item in entries if isinstance(item, dict)]


def project_choices() -> list[dict]:
    # Only safe metadata reaches the browser; no connection details or secrets.
    return [
        {"id": p["id"], "name": p.get("name") or f"Project {p['id']}",
         "repositoryConnected": bool(p.get("repository_id") or p.get("repository")),
         "description": p.get("description") or ""}
        for p in _items(dbt_cloud.projects(), "projects")
        if type(p.get("id")) is int
    ]


def _project_details(project_id: int) -> tuple[dict, list[dict]]:
    response = dbt_cloud.project(project_id)
    project = response.get("data") if isinstance(response, dict) else None
    if not isinstance(project, dict) or project.get("id") != project_id:
        raise team_portal.PortalError("dbt project could not be verified", 502)
    environments = [
        {"id": env["id"], "name": env.get("name") or f"Environment {env['id']}",
         "type": str(env.get("type") or ""), "deploymentType": str(env.get("deployment_type") or "")}
        for env in _items(dbt_cloud.environments(project_id), "environments")
        if type(env.get("id")) is int and env.get("project_id") == project_id
    ]
    return project, environments


def _repo_name(metadata: dict) -> str:
    # Never accept a manually typed arbitrary repository URL as authority.
    # The Git provider must be the repository actually linked to this project.
    for value in (metadata.get("full_name"), metadata.get("github_repo"),
                  metadata.get("remote_url"), metadata.get("git_clone_url")):
        if not isinstance(value, str):
            continue
        normalized = value.strip().removesuffix(".git").rstrip("/")
        normalized = re.sub(r"^(?:https?://|ssh://git@|git@)github\.com[:/]", "", normalized)
        if GITHUB_REPO.fullmatch(normalized):
            return normalized
    raise team_portal.PortalError("This dbt project does not have a supported GitHub repository connected", 422)


def _connected_repo(project: dict) -> str:
    info = project.get("repository")
    if isinstance(info, dict):
        try:
            return _repo_name(info)
        except team_portal.PortalError:
            pass
    repository_id = project.get("repository_id")
    if type(repository_id) is not int or repository_id <= 0:
        raise team_portal.PortalError("Connect a GitHub repository to the dbt project first", 422)
    data = dbt_cloud.repository(repository_id).get("data")
    if not isinstance(data, dict):
        raise team_portal.PortalError("Could not read the dbt project's Git repository", 502)
    return _repo_name(data)


def _subdirectory(project: dict) -> str:
    raw = (project.get("dbt_project_subdirectory") or "").strip("/")
    if not raw:
        return ""
    if any(not SEGMENT.fullmatch(item) or item in (".", "..") for item in raw.split("/")):
        raise team_portal.PortalError("Unsupported dbt project subdirectory", 422)
    return raw + "/"


def _github(path: str) -> dict:
    token = os.environ.get("PORTAL_GITHUB_READ_TOKEN", "").strip()
    # Public projects can be discovered without a token. For private GitHub
    # repositories, an administrator grants this backend read-only access.
    request = Request("https://api.github.com" + path, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "semantic-governance-portal",
        "X-GitHub-Api-Version": "2022-11-28",
        **({"Authorization": f"Bearer {token}"} if token else {}),
    })
    try:
        with urlopen(request, timeout=20) as response:
            return json.load(response)
    except HTTPError as exc:
        if exc.code in (401, 403, 404):
            raise team_portal.PortalError(
                "Cannot read the connected GitHub repository. An administrator must grant repository read access.", 503
            ) from exc
        raise team_portal.PortalError(f"GitHub project inventory unavailable (HTTP {exc.code})", 502) from exc
    except (URLError, TimeoutError) as exc:
        raise team_portal.PortalError("Unable to reach GitHub for project discovery", 503) from exc


def _repo_read(repo: str) -> dict:
    if not GITHUB_REPO.fullmatch(repo):
        raise team_portal.PortalError("Invalid linked GitHub repository", 422)
    details = _github(f"/repos/{repo}")
    if details.get("full_name", "").lower() != repo.lower():
        raise team_portal.PortalError("GitHub repository identity mismatch", 502)
    branch = details.get("default_branch")
    if not isinstance(branch, str) or not branch or len(branch) > 128:
        raise team_portal.PortalError("GitHub repository has no readable default branch", 422)
    return {"name": details["full_name"], "branch": branch}


def project_preview(project_id: int) -> dict:
    project, environments = _project_details(project_id)
    repository = _connected_repo(project)
    read = _repo_read(repository)
    return {
        "id": project_id, "name": project.get("name") or f"Project {project_id}",
        "repository": read["name"], "defaultBranch": read["branch"],
        "subdirectory": _subdirectory(project),
        "environments": environments,
        # dbt project/warehouse credentials are NEVER read or sent to React.
        "connectionConfigured": bool(project.get("connection_id") or project.get("connection")),
    }


def assign(role: str, project_id: int, environment_id: int) -> dict:
    if role not in TEAM_PREFIX:
        raise team_portal.PortalError("Choose Team A or Team C", 400)
    if type(project_id) is not int or project_id < 1:
        raise team_portal.PortalError("Choose a valid dbt project", 400)
    if type(environment_id) is not int or environment_id < 1:
        raise team_portal.PortalError("Choose an environment from the selected dbt project", 400)
    preview = project_preview(project_id)  # Recheck; do not trust browser claims
    selected = next((item for item in preview["environments"] if item["id"] == environment_id), None)
    if selected is None:
        raise team_portal.PortalError("Selected environment does not belong to the dbt project", 422)
    with connect() as db:
        db.execute("""INSERT INTO project_connections
          (role,project_id,project_name,environment_id,environment_name,repository,branch,subdirectory,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)
          ON CONFLICT(role) DO UPDATE SET
          project_id=excluded.project_id,project_name=excluded.project_name,
          environment_id=excluded.environment_id,environment_name=excluded.environment_name,
          repository=excluded.repository,branch=excluded.branch,
          subdirectory=excluded.subdirectory,updated_at=excluded.updated_at""", (
            role, project_id, preview["name"], environment_id, selected["name"],
            preview["repository"], preview["defaultBranch"], preview["subdirectory"],
            team_portal.now(),
        ))
    return connection_for(role)


def disconnect(role: str) -> None:
    if role not in TEAM_PREFIX:
        raise team_portal.PortalError("Unknown team", 400)
    with connect() as db:
        db.execute("DELETE FROM project_connections WHERE role=?", (role,))


def _safe_path(row: dict, candidate: str) -> bool:
    prefix = row["subdirectory"] + "models/"
    team = TEAM_PREFIX[row["role"]]
    return (
        candidate.startswith(prefix + "staging/" + team + "/")
        or candidate.startswith(prefix + "semantic_models/" + team + "/")
    ) and (candidate.endswith(".sql") or candidate.endswith(".yml") or candidate.endswith(".yaml"))


def _tree(row: dict) -> tuple[list[dict], str]:
    repo = row["repository"]
    read = _repo_read(repo)
    branch = read["branch"]  # Reflect current default branch on refresh
    info = _github(f"/repos/{repo}/branches/{quote(branch, safe='')}")
    sha = info.get("commit", {}).get("sha")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise team_portal.PortalError("Could not verify Git revision", 502)
    body = _github(f"/repos/{repo}/git/trees/{sha}?recursive=1")
    if body.get("truncated"):
        raise team_portal.PortalError("Project file catalog was truncated; ask the administrator to configure a narrower repository", 422)
    return [item for item in body.get("tree", []) if item.get("type") == "blob"
            and isinstance(item.get("path"), str) and _safe_path(row, item["path"])], sha


def _file(row: dict, path: str, sha: str) -> str:
    if not _safe_path(row, path):
        raise team_portal.PortalError("The requested file is outside your team's project area", 403)
    url_path = "/".join(quote(part, safe="") for part in path.split("/"))
    data = _github(f"/repos/{row['repository']}/contents/{url_path}?ref={sha}")
    if data.get("encoding") != "base64" or data.get("type") != "file":
        raise team_portal.PortalError("The requested Git model file cannot be read", 502)
    blob = base64.b64decode(data["content"])
    if len(blob) > MAX_FILE_BYTES:
        raise team_portal.PortalError("Model file is too large for the portal", 422)
    return blob.decode("utf-8")


def inventory(role: str) -> dict:
    row = connection_for(role)
    if row is None:
        return {"connection": None, "sources": [], "models": [], "revision": None}
    entries, sha = _tree(row)
    source_paths = sorted(item["path"] for item in entries
                          if item["path"].endswith(".sql")
                          and "/staging/" in item["path"])
    sources = sorted({Path(path).stem for path in source_paths})
    yaml_paths = sorted(item["path"] for item in entries
                        if item["path"].endswith((".yaml", ".yml"))
                        and "/semantic_models/" in item["path"])
    models = []
    for path in yaml_paths[:MAX_INVENTORY_FILES]:
        try:
            parsed = yaml.safe_load(_file(row, path, sha)) or {}
        except (ValueError, yaml.YAMLError, UnicodeError):
            # A malformed existing file should still be visible in Git, but
            # never fabricate model metadata or let one file hide all others.
            models.append({"file": path, "invalid": True})
            continue
        for model in parsed.get("models", []) if isinstance(parsed, dict) else []:
            if not isinstance(model, dict):
                continue
            props = model.get("semantic_model") or {}
            if not isinstance(props, dict):
                props = {}
            meta = (model.get("config") or {}).get("meta") or {}
            if not isinstance(meta, dict):
                meta = {}
            uses = meta.get("uses") or {}
            models.append({
                "file": path,
                "sourceModel": model.get("name", ""),
                "semanticName": props.get("name") or "",
                "description": model.get("description") or "",
                "contract": (
                    {"name": uses.get("name"), "version": uses.get("version")}
                    if isinstance(uses, dict) and uses.get("name") else None
                ),
            })
    return {
        "connection": row, "revision": sha, "sources": sources,
        "models": models[:MAX_INVENTORY_FILES],
        "limited": len(yaml_paths) > MAX_INVENTORY_FILES,
    }


def model_file(role: str, path: str) -> dict:
    row = connection_for(role)
    if row is None:
        raise team_portal.PortalError("Team has no connected dbt project", 404)
    entries, sha = _tree(row)
    if path not in {item["path"] for item in entries}:
        raise team_portal.PortalError("Requested model file is not in the connected project", 404)
    return {"path": path, "revision": sha, "content": _file(row, path, sha)}

"""Team Lead-owned dbt project connections and read-only Git model inventory.

The Team Lead supplies dbt account details in the browser, once. For the
localhost-only POC, the optional lead access code is omitted. The demo role
selector does NOT authenticate users. The HTTP gateway restricts onboarding
requests to the local development origin; do not expose the service publicly.
Service tokens remain encrypted in SQLite with an installation-local Fernet
key stored separately in a private 0600 file. Production requires authenticated
team permissions and centralized secret management.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import re
import threading
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

import yaml
from cryptography.fernet import Fernet, InvalidToken
from . import dbt_cloud, team_portal

TEAM_PREFIX = {"team-a": "team_a", "team-c": "team_c"}
GITHUB_REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
SEGMENT = re.compile(r"^[A-Za-z0-9_.-]+$")
MAX_INVENTORY_FILES = 60
MAX_FILE_BYTES = 100_000
KEY_FILE_NAME = "integrations.key"
_key_lock = threading.Lock()


def require_team(role: str) -> None:
    # This validates the requested team identifier only. Authentication
    # must be added before exposing the portal to anyone beyond localhost.
    if role not in TEAM_PREFIX:
        raise team_portal.PortalError("Only Team A or Team C can connect a dbt project", 403)


def connect():
    conn = team_portal.connect()
    conn.execute("""CREATE TABLE IF NOT EXISTS project_connections (
        role TEXT PRIMARY KEY,
        project_id INTEGER NOT NULL,
        project_name TEXT NOT NULL,
        environment_id INTEGER,
        environment_name TEXT NOT NULL,
        repository TEXT NOT NULL,
        branch TEXT NOT NULL,
        subdirectory TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        account_id INTEGER,
        api_host TEXT,
        token_ciphertext TEXT
    )""")
    # Forward-only migration for anyone who tried the original PR #32 branch.
    columns = {r[1] for r in conn.execute("PRAGMA table_info(project_connections)")}
    for col, kind in (("account_id", "INTEGER"), ("api_host", "TEXT"), ("token_ciphertext", "TEXT")):
        if col not in columns:
            conn.execute(f"ALTER TABLE project_connections ADD COLUMN {col} {kind}")
    return conn


def _fernet() -> Fernet:
    home = team_portal.database_path().parent
    home.mkdir(parents=True, exist_ok=True)
    path = home / KEY_FILE_NAME
    with _key_lock:
        if path.is_symlink():
            raise team_portal.PortalError("Integration encryption key is not safe", 503)
        if not path.exists():
            try:
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                pass
            else:
                try:
                    with os.fdopen(fd, "wb") as file:
                        file.write(Fernet.generate_key())
                except Exception:
                    path.unlink(missing_ok=True)
                    raise
        if not path.is_file() or path.stat().st_mode & 0o077:
            raise team_portal.PortalError("Integration key file must be private (permissions 0600)", 503)
        try:
            return Fernet(path.read_bytes())
        except Exception as exc:
            raise team_portal.PortalError("Integration encryption key is invalid", 503) from exc


def _encrypt(token: str) -> str:
    return _fernet().encrypt(token.encode("utf-8")).decode("ascii")


def _decrypt(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        raise team_portal.PortalError("Stored dbt connection secret is unavailable; reconnect the project", 503) from exc


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
        "accountId": row["account_id"], "apiHost": row["api_host"],
        "updatedAt": row["updated_at"],
        # Never expose ciphertext, token, warehouse connection attributes.
    }


def connection_for(role: str) -> dict | None:
    if role not in TEAM_PREFIX:
        raise team_portal.PortalError("Unknown team", 400)
    with connect() as db:
        row = db.execute("SELECT * FROM project_connections WHERE role=?", (role,)).fetchone()
    return _clean(row)


def _items(response: dict, label: str) -> list[dict]:
    entries = response.get("data") if isinstance(response, dict) else None
    if not isinstance(entries, list):
        raise dbt_cloud.DbtCloudError(f"Unexpected dbt {label} response")
    return [x for x in entries if isinstance(x, dict)]


def _credentials(payload: dict) -> dict:
    host = dbt_cloud.validate_host(payload.get("apiHost"))
    value = payload.get("accountId")
    if type(value) is not int or value < 1:
        raise team_portal.PortalError("Provide a valid dbt account ID", 400)
    token = payload.get("serviceToken")
    if not isinstance(token, str) or not token.strip() or len(token) > 4096:
        raise team_portal.PortalError("Enter a valid service token", 400)
    return {"host": host, "accountId": value, "token": token}


def preview_account(role: str, payload: dict) -> dict:
    require_team(role)
    cred = _credentials(payload)
    result = [
        {"id": p["id"], "name": p.get("name") or f"Project {p['id']}",
         "repositoryConnected": bool(p.get("repository_id") or p.get("repository"))}
        for p in _items(dbt_cloud.connected_projects(cred), "projects")
        if type(p.get("id")) is int
    ]
    return {"projects": result, "connection": connection_for(role)}


def _project_details(cred: dict, project_id: int) -> tuple[dict, list[dict]]:
    response = dbt_cloud.connected_project(cred, project_id)
    project = response.get("data") if isinstance(response, dict) else None
    if not isinstance(project, dict) or project.get("id") != project_id:
        raise team_portal.PortalError("dbt project could not be verified", 502)
    environments = [
        {"id": env["id"], "name": env.get("name") or f"Environment {env['id']}",
         "type": str(env.get("type") or ""), "deploymentType": str(env.get("deployment_type") or "")}
        for env in _items(dbt_cloud.connected_environments(cred, project_id), "environments")
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
        if GITHUB_REPO.fullmatch(normalized) and all(
            component not in (".", "..") for component in normalized.split("/")
        ):
            return normalized
    raise team_portal.PortalError("This dbt project does not have a supported GitHub repository connected", 422)


def _connected_repo(project: dict, cred: dict) -> str:
    info = project.get("repository")
    if isinstance(info, dict):
        try:
            return _repo_name(info)
        except team_portal.PortalError:
            pass
    repository_id = project.get("repository_id")
    if type(repository_id) is not int or repository_id <= 0:
        raise team_portal.PortalError("Connect a GitHub repository to the dbt project first", 422)
    data = dbt_cloud.connected_repository(cred, repository_id).get("data")
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

def preview_project(role: str, payload: dict) -> dict:
    require_team(role)
    cred = _credentials(payload)
    project_id = payload.get("projectId")
    if type(project_id) is not int or project_id < 1:
        raise team_portal.PortalError("Choose a valid dbt project", 400)
    project, environments = _project_details(cred, project_id)
    repository = _connected_repo(project, cred)
    read = _repo_read(repository)
    return {
        "id": project_id, "name": project.get("name") or f"Project {project_id}",
        "repository": read["name"], "defaultBranch": read["branch"],
        "subdirectory": _subdirectory(project),
        "environments": environments,
        "connectionConfigured": bool(project.get("connection_id") or project.get("connection")),
    }


def assign(role: str, payload: dict) -> dict:
    require_team(role)
    cred = _credentials(payload)
    environment_id = payload.get("environmentId")
    if type(environment_id) is not int or environment_id < 1:
        raise team_portal.PortalError("Choose an environment from the selected project", 400)
    preview = preview_project(role, payload)
    selected = next((e for e in preview["environments"] if e["id"] == environment_id), None)
    if selected is None:
        raise team_portal.PortalError("Selected environment does not belong to the dbt project", 422)
    encrypted = _encrypt(cred["token"])
    with connect() as db:
        db.execute("""INSERT INTO project_connections
          (role,project_id,project_name,environment_id,environment_name,repository,branch,subdirectory,
           updated_at,account_id,api_host,token_ciphertext)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(role) DO UPDATE SET
          project_id=excluded.project_id,project_name=excluded.project_name,
          environment_id=excluded.environment_id,environment_name=excluded.environment_name,
          repository=excluded.repository,branch=excluded.branch,
          subdirectory=excluded.subdirectory,updated_at=excluded.updated_at,
          account_id=excluded.account_id,api_host=excluded.api_host,
          token_ciphertext=excluded.token_ciphertext""", (
            role, preview["id"], preview["name"], environment_id, selected["name"],
            preview["repository"], preview["defaultBranch"], preview["subdirectory"],
            team_portal.now(), cred["accountId"], cred["host"], encrypted,
        ))
    return connection_for(role)


def connection_secret(role: str) -> dict:
    """Internal-only retrieval; never expose this method through HTTP."""
    require_team(role)
    with connect() as db:
        row = db.execute("SELECT * FROM project_connections WHERE role=?", (role,)).fetchone()
    if row is None or not row["token_ciphertext"]:
        raise team_portal.PortalError("Reconnect the dbt Cloud project", 404)
    return {
        "host": row["api_host"], "accountId": row["account_id"],
        "token": _decrypt(row["token_ciphertext"]),
    }


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
    if not GITHUB_REPO.fullmatch(repo) or any(
        component in (".", "..") for component in repo.split("/")
    ):
        raise team_portal.PortalError("Invalid linked GitHub repository", 422)
    details = _github(f"/repos/{repo}")
    if details.get("full_name", "").lower() != repo.lower():
        raise team_portal.PortalError("GitHub repository identity mismatch", 502)
    branch = details.get("default_branch")
    if not isinstance(branch, str) or not branch or len(branch) > 128:
        raise team_portal.PortalError("GitHub repository has no readable default branch", 422)
    return {"name": details["full_name"], "branch": branch}


def _safe_path(row: dict, candidate: str) -> bool:
    if not isinstance(candidate, str) or any(
        segment in (".", "..", "") for segment in candidate.split("/")
    ) or chr(92) in candidate:
        return False
    # Read-only project-wide model discovery; writes remain outside this API.
    # Never expose arbitrary repository secrets or files outside dbt's models tree.
    prefix = row["subdirectory"] + "models/"
    return candidate.startswith(prefix) and candidate.endswith((".sql", ".yml", ".yaml"))


def _tree(row: dict) -> tuple[list[dict], str]:
    repo = row["repository"]
    read = _repo_read(repo)
    branch = read["branch"]  # Reflect current default branch on refresh
    info = _github(f"/repos/{repo}/branches/{quote(branch, safe='')}")
    sha = info.get("commit", {}).get("sha")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise team_portal.PortalError("Could not verify Git revision", 502)
    tree_sha = (info.get("commit", {}).get("commit", {}).get("tree") or {}).get("sha")
    if not isinstance(tree_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", tree_sha):
        raise team_portal.PortalError("Could not verify Git repository tree", 502)
    body = _github(f"/repos/{repo}/git/trees/{tree_sha}?recursive=1")
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
        return {"connection": None, "sources": [], "sourceFiles": [], "models": [], "revision": None}
    entries, sha = _tree(row)
    project_files = sorted(item["path"] for item in entries)
    source_paths = sorted(item["path"] for item in entries
                          if item["path"].endswith(".sql")
                          and "/staging/" in item["path"])
    sources = sorted({Path(path).stem for path in source_paths})
    source_files = [{"name": Path(path).stem, "path": path} for path in source_paths]
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
        "connection": row, "revision": sha, "sources": sources, "sourceFiles": source_files,
        "models": models[:MAX_INVENTORY_FILES],
        "files": project_files,
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

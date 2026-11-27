"""Team-neutral validation context: immutable connected GitHub dbt project snapshot.

GitHub repos are obtained only from verified dbt Cloud project connections.
Archives are downloaded with server-side credentials, bounded, and extracted
without trusting archive paths or following symlinks.
"""
from __future__ import annotations

import io
import re
import shutil
import stat
import zipfile
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from . import project_connections, team_portal

SHA = re.compile(r"^[a-f0-9]{40}$")
MAX_ARCHIVE_BYTES = 35 * 1024 * 1024
MAX_UNPACKED_BYTES = 100 * 1024 * 1024
MAX_FILES = 6000


def team_folder(role: str) -> str:
    """A safe, stable folder convention; no team-specific branches."""
    if not isinstance(role, str) or not re.fullmatch(r"team-[a-z][a-z0-9-]{0,48}", role):
        raise team_portal.PortalError("Invalid team identifier", 400)
    return role.replace("-", "_")


def snapshot(role: str, destination: Path) -> dict:
    """Copy the *entire linked dbt project*, pinned to a verified branch SHA."""
    project_connections.require_team(role)
    connection = project_connections.connection_for(role)
    if not connection:
        raise team_portal.PortalError("Connect the team's dbt project before repository validation", 409)
    repository, branch = connection["repository"], connection["branch"]
    subdirectory = connection["subdirectory"]
    if not project_connections.GITHUB_REPO.fullmatch(repository):
        raise team_portal.PortalError("Invalid linked repository", 422)
    token = ""
    with project_connections.connect() as db:
        row = db.execute("SELECT github_token_ciphertext FROM project_connections WHERE role=?", (role,)).fetchone()
        if row and row["github_token_ciphertext"]:
            token = project_connections._decrypt(row["github_token_ciphertext"])

    details = project_connections._github_request(
        f"/repos/{repository}/branches/{quote(branch, safe='')}", token
    )
    revision = (details.get("commit") or {}).get("sha")
    if not isinstance(revision, str) or not SHA.fullmatch(revision):
        raise team_portal.PortalError("Could not verify connected project's Git revision", 502)
    url = f"https://api.github.com/repos/{repository}/zipball/{revision}"
    headers = {"Accept": "application/vnd.github+json",
               "User-Agent": "semantic-governance-portal"}
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        with urlopen(Request(url, headers=headers), timeout=45) as stream:
            payload = stream.read(MAX_ARCHIVE_BYTES + 1)
    except (HTTPError, URLError, TimeoutError) as exc:
        raise team_portal.PortalError("Cannot download the connected dbt project for validation", 503) from exc
    if len(payload) > MAX_ARCHIVE_BYTES:
        raise team_portal.PortalError("Connected project archive exceeds validation limit", 422)

    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            members = archive.infolist()
            if len(members) > MAX_FILES:
                raise ValueError("Too many files")
            # GitHub archives contain a generated top-level directory.
            roots = {p.filename.split("/", 1)[0] for p in members if "/" in p.filename}
            if len(roots) != 1:
                raise ValueError("Unexpected GitHub archive layout")
            root = next(iter(roots))
            prefix = root + "/" + subdirectory
            destination.mkdir(parents=True, exist_ok=True)
            total = 0
            for item in members:
                path = item.filename
                if not path.startswith(prefix):
                    continue
                rel = path[len(prefix):]
                if not rel:
                    continue
                parts = rel.rstrip("/").split("/")
                if any(part in ("", ".", "..") for part in parts):
                    raise ValueError("Unsafe archive entry")
                mode = (item.external_attr >> 16)
                if stat.S_ISLNK(mode):
                    raise ValueError("Archive contains a symlink")
                target = destination.joinpath(*parts)
                if item.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                total += item.file_size
                if total > MAX_UNPACKED_BYTES or item.file_size > 10 * 1024 * 1024:
                    raise ValueError("Project archive exceeds extraction limits")
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(item) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
    except (zipfile.BadZipFile, OSError, ValueError, RuntimeError) as exc:
        raise team_portal.PortalError(f"Could not safely read linked dbt project: {exc}", 422) from exc
    if not (destination / "dbt_project.yml").is_file():
        raise team_portal.PortalError("Connected GitHub project does not contain dbt_project.yml", 422)
    return {"repository": repository, "branch": branch, "revision": revision,
            "subdirectory": subdirectory}

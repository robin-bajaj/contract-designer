"""GitHub App authentication. Credentials are server-only, never in SQLite or the browser.

Configure GITHUB_APP_ID, GITHUB_APP_SLUG and GITHUB_APP_PRIVATE_KEY_PATH
through deployment secrets. Do not commit private keys. Local portal is loopback-only.
"""
from __future__ import annotations
import base64
import json
import os
import re
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from . import team_portal

_REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_SLUG = re.compile(r"^[a-zA-Z0-9-]+$")
_API = "https://api.github.com"

def configured() -> bool:
    return bool(os.environ.get("GITHUB_APP_ID") and os.environ.get("GITHUB_APP_SLUG") and os.environ.get("GITHUB_APP_PRIVATE_KEY_PATH"))

def installation_url() -> str | None:
    slug = os.environ.get("GITHUB_APP_SLUG", "")
    if not configured() or not _SLUG.fullmatch(slug):
        return None
    return "https://github.com/apps/" + slug + "/installations/new"

def _jwt() -> str:
    app_id = os.environ.get("GITHUB_APP_ID", "")
    if not app_id.isdigit() or int(app_id) < 1:
        raise team_portal.PortalError("GitHub App ID is not configured", 503)
    filename = os.environ.get("GITHUB_APP_PRIVATE_KEY_PATH", "")
    if not filename:
        raise team_portal.PortalError("GitHub App signing key is not configured", 503)
    key_file = Path(filename)
    if not key_file.is_file():
        raise team_portal.PortalError("GitHub App signing key file does not exist", 503)
    if os.name == "posix" and key_file.stat().st_mode & 0o077:
        raise team_portal.PortalError("GitHub App signing key must have private permissions (0600)", 503)
    try:
        private_key = serialization.load_pem_private_key(key_file.read_bytes(), password=None)
        now = int(time.time())
        def part(value):
            return base64.urlsafe_b64encode(json.dumps(value,separators=(",",":")).encode()).rstrip(b"=").decode()
        unsigned = part({"alg":"RS256","typ":"JWT"})+"."+part({"iat":now-60,"exp":now+540,"iss":app_id})
        signature=private_key.sign(unsigned.encode(),padding.PKCS1v15(),hashes.SHA256())
        return unsigned+"."+base64.urlsafe_b64encode(signature).rstrip(b"=").decode()
    except (ValueError, TypeError) as exc:
        raise team_portal.PortalError("GitHub App signing key could not be loaded", 503) from exc

def _request(path: str, token: str, *, method: str="GET", body: dict | None=None) -> dict:
    if not path.startswith("/") or path.startswith("//") or any(c in path for c in "\\r\n"):
        raise team_portal.PortalError("Invalid GitHub API path", 400)
    request=Request(_API+path,method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Accept":"application/vnd.github+json","Authorization":"Bearer "+token,
                 "User-Agent":"semantic-governance-portal","X-GitHub-Api-Version":"2022-11-28",
                 **({"Content-Type":"application/json"} if body is not None else {})})
    try:
        with urlopen(request,timeout=20) as response:
            return json.load(response)
    except HTTPError as exc:
        if exc.code == 404:
            raise team_portal.PortalError("GitHub App is not installed for the connected repository, or cannot access it", 404) from exc
        if exc.code in (401,403):
            raise team_portal.PortalError("GitHub App authentication or repository permissions were denied", 403) from exc
        raise team_portal.PortalError("GitHub App request failed (HTTP "+str(exc.code)+")", 502) from exc
    except (URLError,TimeoutError) as exc:
        raise team_portal.PortalError("Cannot reach GitHub App API", 503) from exc

def installation_for_repo(repo: str) -> int:
    if not _REPO.fullmatch(repo):
        raise team_portal.PortalError("Invalid linked repository", 422)
    from urllib.parse import quote
    data=_request("/repos/"+"/".join(quote(p,safe="") for p in repo.split("/"))+"/installation",_jwt())
    ident=data.get("id")
    if type(ident) is not int or ident < 1:
        raise team_portal.PortalError("GitHub did not return a valid installation", 502)
    return ident

def token_for_installation(installation_id: int) -> str:
    if type(installation_id) is not int or installation_id < 1:
        raise team_portal.PortalError("Invalid GitHub installation ID", 400)
    data=_request("/app/installations/"+str(installation_id)+"/access_tokens",_jwt(),method="POST",
                  body={"permissions":{"contents":"read"}})
    token=data.get("token")
    if not isinstance(token,str) or not token:
        raise team_portal.PortalError("GitHub App installation token unavailable", 502)
    return token

def verify_repository(repo: str) -> int:
    installation_id=installation_for_repo(repo)
    token=token_for_installation(installation_id)
    from urllib.parse import quote
    path="/repos/"+"/".join(quote(p,safe="") for p in repo.split("/"))
    data=_request(path,token)
    if data.get("full_name","").lower()!=repo.lower():
        raise team_portal.PortalError("GitHub installation repository identity mismatch", 403)
    return installation_id

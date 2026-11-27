"""CDO-owned GitHub App webhook and required Check Run integration.

The API only verifies and enqueues events. Validation must run on isolated,
restricted workers: never execute PR dbt/Jinja within the API process.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from . import central_ci, team_portal

CHECK_NAME = "CDO Central Semantic Validation"
MAX_WEBHOOK = 1024 * 1024
SUPPORTED = {"opened", "reopened", "synchronize", "ready_for_review"}
SHA = re.compile(r"^[a-f0-9]{40}$")


class AppError(RuntimeError):
    pass


def verify_webhook(body: bytes, signature: str | None, secret: str | None = None) -> bool:
    key = secret if secret is not None else os.environ.get("GITHUB_APP_WEBHOOK_SECRET", "")
    if not key or not isinstance(signature, str) or not signature.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(key.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def app_jwt(app_id: str, pem: str, *, now: int | None = None) -> str:
    current = int(time.time()) if now is None else now
    def encode(obj):
        value = json.dumps(obj, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(value).rstrip(b"=").decode()
    head = encode({"typ": "JWT", "alg": "RS256"})
    payload = encode({"iat": current - 60, "exp": current + 540, "iss": str(app_id)})
    value = (head + "." + payload).encode("ascii")
    private_key = serialization.load_pem_private_key(pem.encode(), password=None)
    signature = private_key.sign(value, padding.PKCS1v15(), hashes.SHA256())
    return head + "." + payload + "." + base64.urlsafe_b64encode(signature).rstrip(b"=").decode()


def github_request(endpoint: str, token: str, *, method: str = "GET", body: dict | None = None) -> dict:
    if not endpoint.startswith("/") or ".." in endpoint or any(ord(c) < 32 or c == chr(92) for c in endpoint):
        raise AppError("Unsafe GitHub endpoint")
    request = Request(
        "https://api.github.com" + endpoint, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Accept": "application/vnd.github+json",
                 "Authorization": "Bearer " + token,
                 "X-GitHub-Api-Version": "2022-11-28",
                 "Content-Type": "application/json", "User-Agent": "cdo-central-ci"},
    )
    try:
        with urlopen(request, timeout=25) as response:
            return json.load(response)
    except (HTTPError, URLError, TimeoutError) as exc:
        raise AppError("GitHub API request failed while reporting CI results") from exc


def installation_token(installation_id: int) -> str:
    app_id = os.environ.get("GITHUB_APP_ID", "")
    pem = os.environ.get("GITHUB_APP_PRIVATE_KEY", "").replace("\\n", "\n")
    if not app_id.isdigit() or not pem:
        raise AppError("GitHub App credentials are not configured")
    result = github_request(
        f"/app/installations/{installation_id}/access_tokens",
        app_jwt(app_id, pem), method="POST")
    token = result.get("token")
    if not isinstance(token, str) or not token:
        raise AppError("GitHub installation did not return an access token")
    return token


def parse_event(event_name: str, body: dict) -> dict | None:
    if event_name != "pull_request" or body.get("action") not in SUPPORTED:
        return None
    repo = (body.get("repository") or {}).get("full_name")
    number = (body.get("pull_request") or {}).get("number")
    pr = body.get("pull_request") or {}
    head = pr.get("head") or {}
    base = pr.get("base") or {}
    sha = head.get("sha")
    branch = head.get("ref")
    installation_id = (body.get("installation") or {}).get("id")
    if (not isinstance(repo, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo)
            or type(number) is not int or type(installation_id) is not int
            or not isinstance(branch, str) or not isinstance(sha, str) or not SHA.fullmatch(sha)
            or (head.get("repo") or {}).get("full_name") != repo):
        return None  # No cross-repository PR execution in this initial implementation.
    role = central_ci.candidate_role(repo, branch)
    if role is None:
        return None
    connection = central_ci.project_connections.connection_for(role)
    if not connection or (base.get("ref") != connection["branch"]):
        return None
    return {"repository": repo, "sha": sha, "role": role, "pr": number,
            "installation": installation_id}


def check_run(token: str, event: dict, status: str, *, result: dict | None = None) -> int:
    if status == "in_progress":
        payload = {"name": CHECK_NAME, "head_sha": event["sha"], "status": status}
    else:
        success = bool(result and result.get("ok"))
        description = (result or {}).get("summary") or (result or {}).get("error") or "Central validation failed"
        payload = {
            "name": CHECK_NAME, "head_sha": event["sha"], "status": "completed",
            "conclusion": "success" if success else "failure",
            "output": {
                "title": "Central dbt validation passed" if success else "Central dbt validation failed",
                "summary": description[:65000],
                "text": "\n".join(f"- {x['name']}: {x['status']}" for x in (result or {}).get("steps", [])),
            },
        }
    response = github_request(f"/repos/{event['repository']}/check-runs", token,
                              method="POST", body=payload)
    number = response.get("id")
    if type(number) is not int:
        raise AppError("GitHub did not create a Check Run")
    return number


def handle_verified_event(event_name: str, payload: dict, *, dispatch) -> bool:
    event = parse_event(event_name, payload)
    if event is None:
        return False
    dispatch(event)
    return True


def execute_event(event: dict) -> dict:
    """Called by an isolated worker process, never directly by a webhook handler."""
    token = installation_token(event["installation"])
    # Reject stale deliveries: never report success for a replaced PR head.
    pr = github_request(f"/repos/{event['repository']}/pulls/{event['pr']}", token)
    if ((pr.get("head") or {}).get("sha") != event["sha"]
            or not str((pr.get("head") or {}).get("ref", "")).startswith(
                "portal/" + central_ci.team_ids.folder(event["role"]) + "/")
            or (pr.get("base") or {}).get("ref") != central_ci.project_connections.connection_for(event["role"])["branch"]):
        return {"ok": False, "error": "PR commit or team branch changed; enqueue latest commit"}
    check_run(token, event, "in_progress")
    try:
        result = central_ci.validate_pr(event["role"], event["repository"], event["sha"])
    except Exception:
        result = {"ok": False, "error": "Central validation worker raised an error"}
    check_run(token, event, "completed", result=result)
    return result

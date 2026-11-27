"""Commit portal-authored models to federated-semantic-poc, then gate PR on Neon CI.

Branch creation is allowed before validation; a model pull request is NEVER
opened until the exact pushed commit has a successful database-backed workflow.

This is for the localhost POC. PORTAL_GITHUB_TOKEN is a server-side fine-grained
token with Contents/Actions/Pull requests write on federated-semantic-poc.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from . import team_portal

REPO = "robin-bajaj/federated-semantic-poc"
API = f"https://api.github.com/repos/{REPO}"
WORKFLOW = "portal-prepublish.yml"
SHA = re.compile(r"^[0-9a-f]{40}$")
_lock = threading.RLock()


class PublishingError(team_portal.PortalError):
    pass


def gh(method: str, path: str, payload: dict | None = None, *, opener=None) -> dict:
    """Only fetch approved GitHub API paths; no caller-controlled host."""
    if not path.startswith("/") or ".." in path or "://" in path:
        raise PublishingError("Invalid GitHub API path")
    token = os.environ.get("PORTAL_GITHUB_TOKEN", "").strip()
    if not token:
        raise PublishingError("Publishing integration is not connected. An administrator must configure its GitHub access.", 503)
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(API + path, method=method, data=body, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        **({"Content-Type": "application/json"} if body is not None else {}),
    })
    try:
        with (opener or urlopen)(request, timeout=25) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        # Never return raw provider errors: they could accidentally contain
        # sensitive response data and are not useful to model authors.
        if exc.code == 404:
            raise PublishingError("Pre-publish workflow is unavailable. Merge the workflow setup PR in the federated repository first.", 503) from exc
        if exc.code in (401, 403):
            raise PublishingError("Publishing access is not authorized. Ask the administrator to check GitHub permissions.", 503) from exc
        raise PublishingError(f"GitHub publishing request failed (HTTP {exc.code})", 502) from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise PublishingError("Cannot reach the configured GitHub publishing service", 503) from exc


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect():
    conn = team_portal.connect()
    conn.execute("""CREATE TABLE IF NOT EXISTS prepublish (
      draft_id TEXT PRIMARY KEY,
      digest TEXT NOT NULL,
      branch TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      base_sha TEXT NOT NULL,
      status TEXT NOT NULL,
      run_id INTEGER,
      run_url TEXT,
      pr_url TEXT,
      error TEXT,
      requested_at TEXT NOT NULL
    )""")
    return conn


def _row_to_dict(row) -> dict:
    return {
        "status": row["status"], "branch": row["branch"],
        "revision": row["commit_sha"], "runUrl": row["run_url"],
        "prUrl": row["pr_url"], "error": row["error"],
    }


def _load(draft_id: str):
    with connect() as conn:
        return conn.execute("SELECT * FROM prepublish WHERE draft_id=?", (draft_id,)).fetchone()


def _revision(draft_id: str):
    draft = team_portal.load_draft(draft_id)
    with team_portal.connect() as conn:
        row = conn.execute("SELECT validated_digest, compiled_yaml FROM drafts WHERE id=?", (draft_id,)).fetchone()
    current = team_portal.digest(team_portal.validate_input(draft))
    if not row or row["validated_digest"] != current or not row["compiled_yaml"]:
        raise PublishingError("Validate the current model version before requesting a publishing review.", 409)
    return draft, current


def _overlay_files(draft: dict) -> list[dict]:
    team = team_portal.TEAMS[draft["role"]]
    files = [{
        "path": f"models/semantic_models/{team}/{draft['semanticName']}.yml",
        "mode": "100644", "type": "blob", "content": draft["yamlText"],
    }]
    if draft["sourceMode"] == "new":
        files.insert(0, {
            "path": f"models/staging/{team}/{draft['sourceModel']}.sql",
            "mode": "100644", "type": "blob", "content": draft["sourceSql"],
        })
    return files


def _save_state(draft_id: str, revision: str, branch: str, commit: str, base: str, status: str):
    with connect() as conn:
        conn.execute("""INSERT INTO prepublish
            (draft_id,digest,branch,commit_sha,base_sha,status,requested_at)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(draft_id) DO UPDATE SET
              digest=excluded.digest,branch=excluded.branch,
              commit_sha=excluded.commit_sha,base_sha=excluded.base_sha,
              status=excluded.status,run_id=NULL,run_url=NULL,pr_url=NULL,
              error=NULL,requested_at=excluded.requested_at""",
            (draft_id, revision, branch, commit, base, status, now()))


def _update(draft_id: str, **fields):
    allowed = {"status", "run_id", "run_url", "pr_url", "error"}
    if not fields or any(key not in allowed for key in fields):
        raise PublishingError("Invalid pre-publish state")
    query = ",".join(f"{key}=?" for key in fields)
    with connect() as conn:
        conn.execute(f"UPDATE prepublish SET {query} WHERE draft_id=?",
                     (*fields.values(), draft_id))


def start(draft_id: str) -> dict:
    """Create candidate branch + dispatch database build. No model PR yet."""
    with _lock:
        draft, revision = _revision(draft_id)
        prior = _load(draft_id)
        if prior and prior["digest"] == revision and prior["status"] not in ("failed",):
            return _row_to_dict(prior)
        # Fail early if workflow was not merged into default branch.
        gh("GET", f"/actions/workflows/{WORKFLOW}")
        main = gh("GET", "/git/ref/heads/main")["object"]["sha"]
        if not SHA.fullmatch(main):
            raise PublishingError("Cannot determine the federated project revision", 502)
        source_tree = gh("GET", f"/git/commits/{main}")["tree"]["sha"]
        tree = gh("POST", "/git/trees", {
            "base_tree": source_tree,
            "tree": _overlay_files(draft),
        })["sha"]
        commit = gh("POST", "/git/commits", {
            "message": f"feat({draft['role']}): propose {draft['semanticName']} through portal",
            "tree": tree,
            "parents": [main],
        })["sha"]
        if not SHA.fullmatch(commit):
            raise PublishingError("GitHub returned an invalid candidate commit", 502)
        branch = f"portal/{team_portal.TEAMS[draft['role']]}/{draft['sourceModel']}-{uuid.uuid4().hex[:10]}"
        gh("POST", "/git/refs", {"ref": f"refs/heads/{branch}", "sha": commit})
        _save_state(draft_id, revision, branch, commit, main, "dispatching")
        try:
            gh("POST", f"/actions/workflows/{WORKFLOW}/dispatches", {
                "ref": branch,
                "inputs": {"expected_sha": commit, "source_model": draft["sourceModel"]},
            })
        except PublishingError as exc:
            _update(draft_id, status="failed", error=str(exc))
            raise
        _update(draft_id, status="waiting")
        return _row_to_dict(_load(draft_id))


def inspect(draft_id: str) -> dict:
    """Check remote dbt build; open PR only if exact candidate SHA passed."""
    with _lock:
        draft, revision = _revision(draft_id)
        state = _load(draft_id)
        if state is None:
            raise PublishingError("No publishing request exists for this model", 404)
        if state["digest"] != revision:
            # State still belongs to an old revision; no PR for new edits.
            return {"status": "failed", "error": "The model changed after submitting. Validate the new version before publishing."}
        if state["status"] in ("failed", "pr-opened", "dispatching"):
            return _row_to_dict(state)

        query = quote(state["branch"], safe="")
        runs = gh("GET", f"/actions/workflows/{WORKFLOW}/runs?branch={query}&event=workflow_dispatch&per_page=30")
        matches = [
            run for run in runs.get("workflow_runs", [])
            if run.get("head_sha") == state["commit_sha"]
               and run.get("event") == "workflow_dispatch"
               and run.get("head_branch") == state["branch"]
               and run.get("created_at", "") >= state["requested_at"][:19]
        ]
        if not matches:
            return _row_to_dict(state)
        run = sorted(matches, key=lambda item: item.get("id", 0), reverse=True)[0]
        run_id, url = run.get("id"), run.get("html_url")
        if not isinstance(run_id, int):
            raise PublishingError("Invalid preflight workflow response", 502)
        _update(draft_id, run_id=run_id, run_url=url)
        if run.get("status") != "completed":
            _update(draft_id, status="running")
            return _row_to_dict(_load(draft_id))
        if run.get("conclusion") != "success":
            _update(draft_id, status="failed",
                    error="Database-backed validation failed. No model PR was created. Review the workflow errors, correct the model and rerun validation.")
            return _row_to_dict(_load(draft_id))

        # Never open a PR for a different revision or a changed base branch.
        head = gh("GET", f"/git/ref/heads/{state['branch']}")["object"]["sha"]
        base = gh("GET", "/git/ref/heads/main")["object"]["sha"]
        if head != state["commit_sha"] or base != state["base_sha"]:
            _update(draft_id, status="failed", error="The candidate or destination main branch changed. Revalidate against the latest project.")
            return _row_to_dict(_load(draft_id))

        pr = gh("POST", "/pulls", {
            "title": f"[Portal {draft['role']}] {draft['semanticName']}",
            "head": state["branch"], "base": "main",
            "body": (
                f"Proposed from Semantic Governance Portal.\n\n"
                f"Source model: \`{draft['sourceModel']}\`\n"
                f"Semantic model: \`{draft['semanticName']}\`\n\n"
                f"**Mandatory pre-PR Neon build passed** for exact commit "
                f"\`{state['commit_sha']}\`.\n"
                f"Preflight workflow: {url}\n\n"
                f"Files are portal-authored source SQL and CDO-inheritance YAML. "
                f"The federated CI compiler expands inheritance before dbt build."
            ),
        })
        if not pr.get("html_url"):
            raise PublishingError("Pull request response did not contain a URL", 502)
        _update(draft_id, status="pr-opened", pr_url=pr["html_url"])
        return _row_to_dict(_load(draft_id))

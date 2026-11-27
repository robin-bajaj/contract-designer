"""Validated model publication to GitHub feature branches and pull requests.

No direct writes to main; uses the team-scoped token encrypted by project_connections.
Only new files in the connected team's staging/semantic folders are accepted.
"""
from __future__ import annotations
import json
import re
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from . import project_connections, team_portal, team_ids

_SHA = re.compile(r"^[0-9a-f]{40}$")
_SEGMENT = re.compile(r"^[A-Za-z0-9_.-]+$")

def _request(repo: str, endpoint: str, token: str, *, method="GET", data=None) -> dict:
    if not project_connections.GITHUB_REPO.fullmatch(repo) or not endpoint.startswith("/") or any(
        char in endpoint for char in ("\\", "\r", "\n", "#")
    ):
        raise team_portal.PortalError("Invalid GitHub publication endpoint", 400)
    url = "https://api.github.com/repos/" + "/".join(quote(p, safe="") for p in repo.split("/")) + endpoint
    req = Request(url, method=method, data=json.dumps(data).encode("utf-8") if data is not None else None,
                  headers={"Accept":"application/vnd.github+json",
                           "Authorization":"Bearer " + token,
                           "Content-Type":"application/json",
                           "X-GitHub-Api-Version":"2022-11-28",
                           "User-Agent":"semantic-governance-portal"})
    try:
        with urlopen(req, timeout=25) as response:
            return json.load(response)
    except HTTPError as exc:
        if exc.code in (401,403):
            raise team_portal.PortalError(
                "GitHub denied publication. Your token needs Contents: Read and write and Pull requests: Read and write on the linked repository.", 403
            ) from exc
        if exc.code == 404:
            raise team_portal.PortalError("Linked repository or Git reference was not found", 404) from exc
        if exc.code == 422:
            raise team_portal.PortalError(
                "GitHub rejected the proposed branch or pull request. Check for an existing PR or branch and retry after resolving the conflict.", 409
            ) from exc
        raise team_portal.PortalError(f"GitHub publication failed (HTTP {exc.code})", 502) from exc
    except (URLError,TimeoutError) as exc:
        raise team_portal.PortalError("Cannot reach GitHub to publish the model", 503) from exc

def _team_connection(role: str) -> tuple[dict, str]:
    project_connections.require_team(role)
    with project_connections.connect() as db:
        row = db.execute("SELECT * FROM project_connections WHERE role=?", (role,)).fetchone()
    if row is None:
        raise team_portal.PortalError("Connect your dbt Cloud project first", 409)
    if not row["github_token_ciphertext"]:
        raise team_portal.PortalError(
            "Connect GitHub in Team Lead: Manage connections with Contents and Pull requests write access before publishing.", 409
        )
    conn = project_connections._clean(row)
    token = project_connections._decrypt(row["github_token_ciphertext"])
    return conn, token

def publish(draft: dict, authored_yaml: str, *, expected_revision: str, expected_repository: str) -> dict:
    """Create a GitHub feature branch with one atomic Git commit, then a PR.

    No existing repository paths may be overwritten. Publication is pinned to
    the exact repository revision whose complete dbt project was validated.
    """
    role = draft["role"]
    connection, token = _team_connection(role)
    repo = connection["repository"]
    if repo != expected_repository:
        raise team_portal.PortalError("Connected repository changed; validate the model again", 409)
    if not isinstance(expected_revision, str) or not _SHA.fullmatch(expected_revision):
        raise team_portal.PortalError("A verified Git revision is required before publishing", 409)
    base_branch = connection["branch"]
    subdir = connection["subdirectory"]
    team = team_ids.folder(role)
    if not _SEGMENT.fullmatch(base_branch) or not isinstance(subdir,str):
        raise team_portal.PortalError("Unsupported linked Git branch or project subdirectory", 422)
    paths = {
        subdir + f"models/semantic_models/{team}/{draft['semanticName']}.yml": authored_yaml
    }
    sql_path = subdir + f"models/staging/{team}/{draft['sourceModel']}.sql"
    if draft["sourceMode"] == "new":
        paths[sql_path] = draft["sourceSql"]
    # Never accept arbitrary paths or overwrite source files.
    if any(not path or any(part in ("", ".", "..") for part in path.split("/"))
           or len(path) > 250 for path in paths):
        raise team_portal.PortalError("Invalid model publication path", 422)
    get = lambda endpoint: _request(repo, endpoint, token)
    branch = get("/branches/" + quote(base_branch,safe=""))
    head = (branch.get("commit") or {}).get("sha")
    if not isinstance(head,str) or not _SHA.fullmatch(head):
        raise team_portal.PortalError("Unable to verify target Git branch", 502)
    if head != expected_revision:
        raise team_portal.PortalError("The connected Git branch changed after validation. Revalidate this draft before creating a PR.", 409)
    commit = get("/git/commits/" + head)
    tree_sha = (commit.get("tree") or {}).get("sha")
    if not isinstance(tree_sha,str) or not _SHA.fullmatch(tree_sha):
        raise team_portal.PortalError("Unable to verify target Git tree", 502)
    tree = get("/git/trees/" + tree_sha + "?recursive=1")
    if tree.get("truncated") or not isinstance(tree.get("tree"),list):
        raise team_portal.PortalError("Cannot safely verify existing paths because the Git tree is incomplete", 409)
    existing = {item.get("path") for item in tree["tree"]}
    conflicts = existing.intersection(paths)
    if conflicts:
        raise team_portal.PortalError(
            "Files already exist in the linked GitHub repository: " + ", ".join(sorted(conflicts)) +
            ". Editing existing Git files is not supported yet; choose a new name or an existing-source workflow.", 409)
    if draft["sourceMode"] == "existing" and sql_path not in existing:
        raise team_portal.PortalError(
            "Existing staging SQL is missing from the connected repository: " + sql_path, 409
        )
    # Create a single commit with all model files; main is never changed.
    new_tree = _request(repo,"/git/trees",token,method="POST",data={
        "base_tree":tree_sha,
        "tree":[{"path":path,"mode":"100644","type":"blob","content":content}
                for path,content in paths.items()]
    })
    new_tree_sha=new_tree.get("sha")
    if not isinstance(new_tree_sha,str) or not _SHA.fullmatch(new_tree_sha):
        raise team_portal.PortalError("GitHub did not return a valid model Git tree", 502)
    new_commit=_request(repo,"/git/commits",token,method="POST",data={
        "message":f"Add {role} semantic model {draft['semanticName']}",
        "tree":new_tree_sha,"parents":[head]
    })
    new_sha=new_commit.get("sha")
    if not isinstance(new_sha,str) or not _SHA.fullmatch(new_sha):
        raise team_portal.PortalError("GitHub did not return a valid model commit", 502)
    feature=f"portal/{team}/{draft['semanticName']}-{draft['id'][:8]}"
    _request(repo,"/git/refs",token,method="POST",data={
        "ref":"refs/heads/"+feature,"sha":new_sha
    })
    pr=_request(repo,"/pulls",token,method="POST",data={
        "title":f"{role}: add {draft['semanticName']} semantic model",
        "head":feature,"base":base_branch,
        "body":("Portal generated files (source revision: `"+head[:12]+"`).\n\n"
                "CDO compiler and dbt parse validation passed against the connected repository revision. "
                "Review CI checks and CDO contract compliance before merging.\n\n"
                "Files:\n" + "\n".join("- `"+path+"`" for path in paths))
    })
    url=pr.get("html_url")
    number=pr.get("number")
    if (not isinstance(url,str) or
        not url.startswith("https://github.com/"+repo+"/pull/") or
        type(number) is not int):
        raise team_portal.PortalError(
            "GitHub created a branch but did not return a verified PR URL. Check the repository before retrying.", 502
        )
    return {"status":"pr-open","repository":repo,"branch":feature,"base":base_branch,
            "prUrl":url,"prNumber":number,"paths":list(paths),
            "message":"Pull request created. Files are on a feature branch, not merged into main."}

"""Durable central validation queue; API never executes untrusted dbt code."""
from __future__ import annotations

import json
from . import team_portal


def connect():
    db = team_portal.connect()
    db.execute("""CREATE TABLE IF NOT EXISTS central_ci_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repository TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        commit_sha TEXT NOT NULL,
        team_role TEXT NOT NULL,
        installation_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(repository, pr_number, commit_sha)
    )""")
    return db


def enqueue(event: dict) -> int:
    with connect() as db:
        db.execute("""INSERT OR IGNORE INTO central_ci_jobs
          (repository,pr_number,commit_sha,team_role,installation_id,status,created_at,updated_at)
          VALUES (?,?,?,?,?,'queued',?,?)""",
          (event["repository"], event["pr"], event["sha"], event["role"],
           event["installation"], team_portal.now(), team_portal.now()))
        row = db.execute(
            "SELECT id FROM central_ci_jobs WHERE repository=? AND pr_number=? AND commit_sha=?",
            (event["repository"], event["pr"], event["sha"])).fetchone()
    return row["id"]


def claim_one() -> dict | None:
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM central_ci_jobs WHERE status='queued' ORDER BY id LIMIT 1").fetchone()
        if row is None:
            return None
        changed = db.execute("UPDATE central_ci_jobs SET status='running',updated_at=? WHERE id=? AND status='queued'",
                             (team_portal.now(), row["id"]))
        if changed.rowcount != 1:
            return None
    return {"id": row["id"], "repository": row["repository"], "pr": row["pr_number"],
            "sha": row["commit_sha"], "role": row["team_role"],
            "installation": row["installation_id"]}


def finish(job_id: int, result: dict) -> None:
    with connect() as db:
        db.execute("UPDATE central_ci_jobs SET status=?,result_json=?,updated_at=? WHERE id=?",
                   ("passed" if result.get("ok") else "failed",
                    json.dumps(result)[:40000], team_portal.now(), job_id))


def status(role: str, pr_number: int) -> list[dict]:
    with connect() as db:
        rows = db.execute("""SELECT repository,pr_number,commit_sha,status,result_json,updated_at
                             FROM central_ci_jobs WHERE team_role=? AND pr_number=? ORDER BY id DESC LIMIT 10""",
                          (role, pr_number)).fetchall()
    return [{"repository": x["repository"], "prNumber": x["pr_number"],
             "sha": x["commit_sha"], "status": x["status"],
             "result": json.loads(x["result_json"]) if x["result_json"] else None,
             "updatedAt": x["updated_at"]} for x in rows]

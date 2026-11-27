"""Local-development catalog of team workspaces (not an authorization service)."""
from __future__ import annotations

from . import team_ids, team_portal

DEFAULTS = (
    ("team-a", "Team A", "Equities · Team semantic models"),
    ("team-c", "Team C", "Fixed Income · Team semantic models"),
)


def connect():
    db = team_portal.connect()
    db.execute("""CREATE TABLE IF NOT EXISTS team_registry (
        role TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""")
    for role, label, description in DEFAULTS:
        db.execute(
            "INSERT OR IGNORE INTO team_registry (role,label,description,created_at) VALUES (?,?,?,?)",
            (role, label, description, team_portal.now())
        )
    return db


def list_roles() -> list[dict]:
    with connect() as db:
        stored = db.execute(
            "SELECT role,label,description FROM team_registry ORDER BY role"
        ).fetchall()
    teams = [{"id": row["role"], "label": row["label"], "description": row["description"]}
             for row in stored]
    return [{"id": "cdo", "label": "CDO", "description": "Central Data Office · Govern enterprise contracts"},
            *teams]


def register(payload: dict) -> dict:
    if not isinstance(payload, dict) or not team_ids.is_team(payload.get("role")):
        raise team_portal.PortalError("Use a team role such as team-risk or team-analytics", 400)
    role = payload["role"]
    label = payload.get("label")
    description = payload.get("description") or "Independent dbt semantic models"
    if not isinstance(label, str) or not 2 <= len(label.strip()) <= 70:
        raise team_portal.PortalError("Team display name must be 2–70 characters", 400)
    if not isinstance(description, str) or len(description) > 160:
        raise team_portal.PortalError("Team description must be at most 160 characters", 400)
    with connect() as db:
        existing = db.execute("SELECT role FROM team_registry WHERE role=?", (role,)).fetchone()
        if existing:
            raise team_portal.PortalError("Team identifier already registered", 409)
        db.execute("INSERT INTO team_registry (role,label,description,created_at) VALUES (?,?,?,?)",
                   (role, label.strip(), description.strip(), team_portal.now()))
    return {"id": role, "label": label.strip(), "description": description.strip()}

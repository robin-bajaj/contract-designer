"""Portal-owned Team A/C drafts and validation-gated GitHub PR publication.

Local development only: real authentication/RBAC is required for deployment.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from .managed_project import ensure_project

IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]*$")
TEAMS = {"team-a": "team_a", "team-c": "team_c"}
MAX_YAML = 80_000
MAX_SQL = 40_000


class PortalError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def project_path() -> Path:
    """Return the auto-created workspace. No DBT_PROJECT_PATH is needed."""
    return ensure_project(database_path().parent)


def database_path() -> Path:
    value = os.environ.get("PORTAL_DB_PATH", ".portal/models.sqlite3")
    return Path(value).expanduser().resolve()


def connect():
    db = database_path()
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db, timeout=12)
    conn.row_factory = sqlite3.Row
    conn.execute("""CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        source_model TEXT NOT NULL,
        semantic_name TEXT NOT NULL,
        source_mode TEXT NOT NULL,
        source_sql TEXT,
        yaml_text TEXT NOT NULL,
        draft_data TEXT,
        validated_digest TEXT,
        compiled_yaml TEXT,
        published_at TEXT,
        pr_url TEXT,
        pr_number INTEGER,
        updated_at TEXT NOT NULL
    )""")
    # Existing POC databases created before the draft-data feature are migrated.
    columns = {row[1] for row in conn.execute("PRAGMA table_info(drafts)")}
    if "draft_data" not in columns:
        conn.execute("ALTER TABLE drafts ADD COLUMN draft_data TEXT")
    for column, sqltype in (("pr_url", "TEXT"), ("pr_number", "INTEGER")):
        if column not in columns:
            conn.execute(f"ALTER TABLE drafts ADD COLUMN {column} {sqltype}")
    return conn


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def validate_input(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise PortalError("Expected a JSON object")
    role = payload.get("role")
    if role not in TEAMS:
        raise PortalError("Only Team A and Team C can create team models")
    source = payload.get("sourceModel")
    semantic = payload.get("semanticName")
    if not all(isinstance(x, str) and IDENTIFIER.fullmatch(x) for x in (source, semantic)):
        raise PortalError("Enter valid lowercase source and semantic model names")
    mode = payload.get("sourceMode")
    sql = payload.get("sourceSql")
    if mode not in ("new", "existing"):
        raise PortalError("Invalid source mode")
    if mode == "new" and (not isinstance(sql, str) or not sql.strip() or len(sql) > MAX_SQL):
        raise PortalError("New staging SQL is required (maximum 40 KB)")
    if mode == "existing":
        sql = None
    yml = payload.get("yamlText")
    if not isinstance(yml, str) or not yml.strip() or len(yml) > MAX_YAML:
        raise PortalError("Semantic YAML is required (maximum 80 KB)")
    try:
        import yaml
        doc = yaml.safe_load(yml)
    except Exception as exc:
        raise PortalError(f"Invalid YAML: {exc}") from exc
    models = doc.get("models") if isinstance(doc, dict) else None
    if (not isinstance(models, list) or len(models) != 1
            or not isinstance(models[0], dict)
            or models[0].get("name") != source
            or (models[0].get("semantic_model") or {}).get("name") != semantic):
        raise PortalError("YAML must define exactly this staging and semantic model")
    return {"role": role, "sourceModel": source, "semanticName": semantic,
            "sourceMode": mode, "sourceSql": sql, "yamlText": yml}


def digest(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True,
                                    separators=(",", ":")).encode("utf-8")).hexdigest()


def public(row: sqlite3.Row) -> dict:
    item = {
        "id": row["id"], "role": row["role"], "sourceModel": row["source_model"],
        "semanticName": row["semantic_name"], "sourceMode": row["source_mode"],
        "sourceSql": row["source_sql"], "yamlText": row["yaml_text"],
        "draftData": json.loads(row["draft_data"] or "{}"),
        "publishedAt": row["published_at"], "updatedAt": row["updated_at"],
        "prUrl": row["pr_url"], "prNumber": row["pr_number"],
    }
    try:
        current = digest(validate_input(item))
    except PortalError:
        current = None
    item["status"] = ("submitted" if row["pr_url"] and row["validated_digest"] == current
                      else "validated" if current is not None and row["validated_digest"] == current
                      else "draft")
    return item


def list_drafts(role: str) -> list[dict]:
    if role not in TEAMS:
        raise PortalError("Unknown team")
    with connect() as conn:
        rows = conn.execute("SELECT * FROM drafts WHERE role = ? ORDER BY updated_at DESC",
                            (role,)).fetchall()
    return [public(row) for row in rows]


def load_draft(draft_id: str) -> dict:
    try:
        uuid.UUID(draft_id)
    except (ValueError, AttributeError, TypeError):
        raise PortalError("Invalid draft ID")
    with connect() as conn:
        row = conn.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
    if not row:
        raise PortalError("Draft not found", 404)
    return public(row)


def delete_draft(draft_id: str, role: str) -> None:
    if role not in TEAMS:
        raise PortalError("Invalid team role", 403)
    draft = load_draft(draft_id)
    if draft["role"] != role:
        raise PortalError("Cannot delete another team's draft", 403)
    if draft["status"] == "submitted":
        raise PortalError("Drafts already submitted for GitHub review cannot be deleted", 409)
    with connect() as conn:
        conn.execute("DELETE FROM drafts WHERE id=? AND role=? AND published_at IS NULL",
                     (draft_id, role))


def save_draft(payload: object) -> dict:
    if not isinstance(payload, dict) or payload.get("role") not in TEAMS:
        raise PortalError("Only Team A and Team C drafts are supported")
    role = payload["role"]
    data = {
        "role": role,
        "sourceModel": payload.get("sourceModel", ""),
        "semanticName": payload.get("semanticName", ""),
        "sourceMode": payload.get("sourceMode", "new"),
        "sourceSql": payload.get("sourceSql"),
        "yamlText": payload.get("yamlText", ""),
    }
    if any(not isinstance(data[k], str) or len(data[k]) > 150 for k in ("sourceModel", "semanticName")):
        raise PortalError("Invalid or oversized model name")
    if data["sourceMode"] not in ("new", "existing"):
        raise PortalError("Invalid source mode")
    if data["sourceSql"] is not None and (not isinstance(data["sourceSql"], str) or len(data["sourceSql"]) > MAX_SQL):
        raise PortalError("Oversized SQL")
    if not isinstance(data["yamlText"], str) or len(data["yamlText"]) > MAX_YAML:
        raise PortalError("Oversized YAML")
    draft_data = payload.get("draftData") or {}
    if not isinstance(draft_data, dict) or len(json.dumps(draft_data)) > 100_000:
        raise PortalError("Invalid or oversized editor draft")
    requested_id = payload.get("id") if isinstance(payload, dict) else None
    if requested_id:
        old = load_draft(requested_id)
        if old["role"] != data["role"]:
            raise PortalError("Cannot edit another team's draft", 403)
    draft_id = requested_id or str(uuid.uuid4())
    before = load_draft(draft_id) if requested_id else None
    try:
        previous_digest = digest(validate_input(before)) if before else None
    except PortalError:
        previous_digest = None
    try:
        new_digest = digest(validate_input(data))
    except PortalError:
        new_digest = None
    with connect() as conn:
        if before:
            # A content edit always invalidates the previous dbt validation.
            conn.execute("""UPDATE drafts SET source_model=?,semantic_name=?,source_mode=?,
                source_sql=?,yaml_text=?,draft_data=?,validated_digest=CASE WHEN ?=? THEN validated_digest ELSE NULL END,
                compiled_yaml=CASE WHEN ?=? THEN compiled_yaml ELSE NULL END,
                published_at=CASE WHEN ?=? THEN published_at ELSE NULL END,updated_at=? WHERE id=?""",
                (data["sourceModel"], data["semanticName"], data["sourceMode"], data["sourceSql"],
                 data["yamlText"], json.dumps(draft_data), previous_digest, new_digest, previous_digest, new_digest,
                 previous_digest, new_digest, now(), draft_id))
        else:
            conn.execute("""INSERT INTO drafts
                (id,role,source_model,semantic_name,source_mode,source_sql,yaml_text,draft_data,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?)""",
                (draft_id, data["role"], data["sourceModel"], data["semanticName"],
                 data["sourceMode"], data["sourceSql"], data["yamlText"], json.dumps(draft_data), now()))
    return load_draft(draft_id)


def mark_validated(draft_id: str, result: dict) -> dict:
    draft = load_draft(draft_id)
    if not result.get("ok") or not result.get("compiledYaml"):
        raise PortalError("Only successful dbt validations with compiled YAML can be recorded", 409)
    current_digest = digest(validate_input(draft))
    with connect() as conn:
        conn.execute("""UPDATE drafts SET validated_digest=?,compiled_yaml=?,published_at=NULL,
                        updated_at=? WHERE id=?""",
                     (current_digest, result["compiledYaml"], now(), draft_id))
    return load_draft(draft_id)


def source_models(role: str) -> list[str]:
    if role not in TEAMS:
        raise PortalError("Unknown team")
    team = TEAMS[role]
    sources = set()
    project = project_path()
    if (project / "dbt_project.yml").is_file():
        folder = project / "models" / "staging" / team
        if folder.exists():
            sources.update(p.stem for p in folder.glob("*.sql") if IDENTIFIER.fullmatch(p.stem))
    for draft in list_drafts(role):
        if draft["status"] == "submitted":
            sources.add(draft["sourceModel"])
    return sorted(sources)


def publish_draft(draft_id: str) -> dict:
    """Publish a successfully validated model to a GitHub PR, not local files."""
    from . import github_publish
    draft = load_draft(draft_id)
    with connect() as conn:
        row = conn.execute(
            "SELECT validated_digest, compiled_yaml, pr_url FROM drafts WHERE id=?",
            (draft_id,)
        ).fetchone()
    current_digest = digest(validate_input(draft))
    if not row or row["validated_digest"] != current_digest or not row["compiled_yaml"]:
        raise PortalError("Validate the latest draft with dbt Core before publishing", 409)
    if row["pr_url"]:
        raise PortalError("Draft was already submitted to GitHub: " + row["pr_url"], 409)
    result = github_publish.publish(draft, row["compiled_yaml"])
    with connect() as conn:
        conn.execute(
            "UPDATE drafts SET published_at=?,pr_url=?,pr_number=?,updated_at=? WHERE id=?",
            (now(), result["prUrl"], result["prNumber"], now(), draft_id)
        )
    return result

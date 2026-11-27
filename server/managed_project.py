"""Create and preserve a private dbt Core project as a portal implementation detail.

The users and the React UI do not need to create a project or choose a path.
The project lives next to the portal's SQLite database; this module never
imports, syncs or modifies the old federated-semantic-poc repository.
"""
from __future__ import annotations

from pathlib import Path
import threading

_lock = threading.RLock()
PROJECT_DIR = "managed_dbt"
PROJECT_FILE = """name: semantic_portal
version: '1.0.0'
config-version: 2
profile: semantic_portal
model-paths: ['models']

models:
  semantic_portal:
    +materialized: view
"""
GROUPS_FILE = """version: 2

groups:
  - name: lob_team_a
    owner:
      name: Team A
  - name: lob_team_c
    owner:
      name: Team C
"""
# dbt Semantic Layer needs a DAY-granularity time spine, even for parse-only
# validation of some semantic models. We provide a PostgreSQL-compatible one.
TIME_SPINE_SQL = """{{ config(materialized='view') }}
select date_day::date as date_day
from generate_series(
    (current_date - interval '5 years')::timestamp,
    (current_date + interval '30 days')::timestamp,
    interval '1 day'
) as generated_dates(date_day)
"""
TIME_SPINE_YAML = """version: 2
models:
  - name: time_spine_daily
    description: Portal-managed daily time spine for semantic metrics
    time_spine:
      standard_granularity_column: date_day
    columns:
      - name: date_day
        data_type: date
        granularity: day
"""
TEAM_DIRS = (
    "models/staging/team_a",
    "models/staging/team_c",
    "models/semantic_models/team_a",
    "models/semantic_models/team_c",
)


class ManagedProjectError(RuntimeError):
    pass


def _create_if_missing(path: Path, content: str) -> None:
    # Never replace an existing or manually edited model/configuration.
    try:
        with path.open("x", encoding="utf-8") as output:
            output.write(content)
    except FileExistsError:
        if not path.is_file() or path.is_symlink():
            raise ManagedProjectError(f"Managed workspace has an invalid file: {path.name}") from None


def ensure_project(portal_home: Path) -> Path:
    """Idempotently provision a single dbt project for Team A and Team C.

    Called by backend startup, validation and publishing. Concurrent requests in
    this process share a lock; existing definitions and published files survive
    restarts. A local deployment can relocate portal_home without UI changes.
    """
    with _lock:
        home = Path(portal_home).expanduser().resolve()
        home.mkdir(parents=True, exist_ok=True)
        project = home / PROJECT_DIR
        if project.is_symlink() or (project.exists() and not project.is_dir()):
            raise ManagedProjectError("The managed model workspace directory is invalid")
        project.mkdir(exist_ok=True)
        config = project / "dbt_project.yml"
        models_dir = project / "models"
        if models_dir.is_symlink() or (models_dir.exists() and not models_dir.is_dir()):
            raise ManagedProjectError("The managed models directory is invalid")
        models_dir.mkdir(exist_ok=True)
        groups = models_dir / "groups.yml"
        _create_if_missing(config, PROJECT_FILE)
        _create_if_missing(groups, GROUPS_FILE)
        _create_if_missing(models_dir / "time_spine_daily.sql", TIME_SPINE_SQL)
        _create_if_missing(models_dir / "time_spine.yml", TIME_SPINE_YAML)
        for folder in TEAM_DIRS:
            location = project / folder
            if location.is_symlink() or (location.exists() and not location.is_dir()):
                raise ManagedProjectError("The managed model workspace has an invalid team folder")
            location.mkdir(parents=True, exist_ok=True)
        # The project should remain the one we provisioned; silently using an
        # unrelated dbt project could publish SQL to the wrong destination.
        current = config.read_text(encoding="utf-8")
        if "name: semantic_portal" not in current or "profile: semantic_portal" not in current:
            raise ManagedProjectError("Managed project configuration is incompatible; administrator action required")
        return project

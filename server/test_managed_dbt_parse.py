"""Real dbt Core smoke test: no warehouse, no user-created project.

This test skips when dbt isn't installed locally. GitHub CI installs backend
requirements so the managed project is actually parsed by dbt there.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from server import team_portal
from server.fast_validate import PROFILE


@unittest.skipUnless(shutil.which("dbt"), "dbt Core not installed")
class ManagedDbtParseSmokeTest(unittest.TestCase):
    def test_provisioned_project_parses_with_team_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            with patch.dict(os.environ, {"PORTAL_DB_PATH": str(home / "models.sqlite3"),
                                         "DBT_PROJECT_PATH": ""}):
                project = team_portal.project_path()
            sql_file = project / "models/staging/team_a/stg_team_a_smoke.sql"
            sql_file.write_text("select 'EQ-001' as position_id", encoding="utf-8")
            yaml_file = project / "models/semantic_models/team_a/smoke.yml"
            yaml_file.write_text("""version: 2
models:
  - name: stg_team_a_smoke
    description: Model created through the portal
    config:
      group: lob_team_a
      access: protected
      contract:
        enforced: true
    semantic_model:
      enabled: true
      name: team_a_smoke
    columns:
      - name: position_id
        data_type: text
""", encoding="utf-8")
            profiles = home / "profiles"
            profiles.mkdir()
            (profiles / "profiles.yml").write_text(
                PROFILE.replace("default:", "semantic_portal:", 1), encoding="utf-8")
            process = subprocess.run(
                ["dbt", "parse", "--project-dir", str(project),
                 "--profiles-dir", str(profiles), "--no-partial-parse"],
                cwd=project, text=True, capture_output=True, timeout=90, check=False,
            )
            self.assertEqual(process.returncode, 0, process.stdout + "\n" + process.stderr)
            self.assertTrue((project / "target" / "manifest.json").exists())


if __name__ == "__main__":
    unittest.main()

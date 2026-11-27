"""Unit tests for backend-managed dbt project provisioning."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from server.managed_project import (
    GROUPS_FILE, PROJECT_FILE, TEAM_DIRS, ManagedProjectError, ensure_project,
)
from server import team_portal


class ManagedProjectTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name) / "portal_data"
        patcher = patch.dict("os.environ", {
            "PORTAL_DB_PATH": str(self.home / "models.sqlite3"),
            "DBT_PROJECT_PATH": "/tmp/old-user-db-project-ignored",
        })
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_provisions_on_first_request_without_manual_setup(self):
        project = team_portal.project_path()
        self.assertEqual(project, self.home / "managed_dbt")
        self.assertEqual((project / "dbt_project.yml").read_text(), PROJECT_FILE)
        self.assertEqual((project / "models/groups.yml").read_text(), GROUPS_FILE)
        for folder in TEAM_DIRS:
            self.assertTrue((project / folder).is_dir(), folder)
        self.assertIn("lob_team_a", GROUPS_FILE)
        self.assertIn("lob_team_c", GROUPS_FILE)
        self.assertNotIn("federated", str(project).lower())

    def test_repeated_starts_preserve_published_files_and_user_changes(self):
        project = ensure_project(self.home)
        model = project / "models/staging/team_a/positions.sql"
        model.write_text("select 1 as position_id")
        config = project / "models/groups.yml"
        config.write_text(config.read_text() + "\n# administrator review note\n")
        second = ensure_project(self.home)
        self.assertEqual(second, project)
        self.assertEqual(model.read_text(), "select 1 as position_id")
        self.assertIn("# administrator review note", config.read_text())

    def test_simultaneous_initializations_do_not_clobber_the_project(self):
        with ThreadPoolExecutor(max_workers=6) as pool:
            projects = list(pool.map(lambda _: ensure_project(self.home), range(12)))
        self.assertEqual(len(set(projects)), 1)
        self.assertTrue((projects[0] / "models/groups.yml").is_file())

    def test_invalid_workspace_root_fails_without_overwriting(self):
        self.home.mkdir()
        target = self.home / "managed_dbt"
        target.write_text("existing data")
        with self.assertRaises(ManagedProjectError):
            ensure_project(self.home)
        self.assertEqual(target.read_text(), "existing data")

    def test_symlinked_team_directory_is_rejected(self):
        project = ensure_project(self.home)
        team = project / "models/staging/team_a"
        team.rmdir()
        outside = self.home / "outside"
        outside.mkdir()
        try:
            team.symlink_to(outside, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("Symlinks unavailable on this platform")
        with self.assertRaises(ManagedProjectError):
            ensure_project(self.home)

    def test_existing_unrelated_dbt_configuration_is_not_replaced(self):
        project = ensure_project(self.home)
        config = project / "dbt_project.yml"
        config.write_text("name: unknown_project\nprofile: other_project\n")
        with self.assertRaises(ManagedProjectError):
            ensure_project(self.home)
        self.assertEqual(config.read_text(), "name: unknown_project\nprofile: other_project\n")


if __name__ == "__main__":
    unittest.main()

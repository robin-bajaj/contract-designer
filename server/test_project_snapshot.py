"""Connected-project validation snapshots: bounded archive and team-agnostic paths."""
import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from server import project_snapshot, team_ids, team_portal

SHA = "a" * 40


def archive(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        for name, body in files.items():
            z.writestr(name, body)
    return buffer.getvalue()


class SnapshotTests(unittest.TestCase):
    def test_any_safe_team_id_gets_its_own_folder(self):
        for role, folder in (
            ("team-a", "team_a"), ("team-c", "team_c"),
            ("team-risk", "team_risk"), ("team-fixed-income", "team_fixed_income")
        ):
            self.assertTrue(team_ids.is_team(role))
            self.assertEqual(project_snapshot.team_folder(role), folder)
        for role in ("cdo", "team-../../etc", "team-Ä", "team-a/../b"):
            self.assertFalse(team_ids.is_team(role))

    def test_snapshots_complete_project_at_exact_revision(self):
        files = {
            "sample-abcdef/dbt_project.yml": "name: linked\nprofile: linked\n",
            "sample-abcdef/models/semantic_models/team_a/a.yml": "version: 2",
            "sample-abcdef/models/semantic_models/team_risk/r.yml": "version: 2",
        }
        connection = {
            "repository": "example/models",
            "branch": "main", "subdirectory": ""
        }

        class Response:
            def __enter__(self): return io.BytesIO(archive(files))
            def __exit__(self, *args): return False

        with tempfile.TemporaryDirectory() as temp:
            with patch("server.project_snapshot.project_connections.require_team"), \
                 patch("server.project_snapshot.project_connections.connection_for", return_value=connection), \
                 patch("server.project_snapshot.project_connections.connect") as db, \
                 patch("server.project_snapshot.project_connections._github_request", return_value={"commit": {"sha": SHA}}), \
                 patch("server.project_snapshot.urlopen", return_value=Response()):
                db.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = None
                result = project_snapshot.snapshot("team-risk", Path(temp)/"linked")
            self.assertEqual(result["revision"], SHA)
            self.assertTrue((Path(temp)/"linked/models/semantic_models/team_a/a.yml").exists())
            self.assertTrue((Path(temp)/"linked/models/semantic_models/team_risk/r.yml").exists())

    def test_archive_traversal_is_rejected(self):
        files = {
            "repo-123/dbt_project.yml": "name: test",
            "repo-123/models/../escape.yml": "invalid",
        }
        connection = {"repository": "example/models", "branch": "main", "subdirectory": ""}
        with tempfile.TemporaryDirectory() as temp:
            with patch("server.project_snapshot.project_connections.require_team"), \
                 patch("server.project_snapshot.project_connections.connection_for", return_value=connection), \
                 patch("server.project_snapshot.project_connections.connect") as db, \
                 patch("server.project_snapshot.project_connections._github_request", return_value={"commit": {"sha": SHA}}), \
                 patch("server.project_snapshot.urlopen") as url:
                db.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = None
                url.return_value.__enter__.return_value = io.BytesIO(archive(files))
                with self.assertRaises(team_portal.PortalError):
                    project_snapshot.snapshot("team-a", Path(temp)/"linked")


if __name__ == "__main__":
    unittest.main()

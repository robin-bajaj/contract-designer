"""GitHub App handshake tests; no external network or real app keys needed."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server import github_app, project_connections as pc, team_portal

class GithubAppConnectionTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        p=patch.dict(os.environ, {"PORTAL_DB_PATH":str(Path(tmp.name)/"portal.sqlite3")})
        p.start();self.addCleanup(p.stop)
        with pc.connect() as db:
            db.execute("""INSERT INTO project_connections
                (role,project_id,project_name,environment_id,environment_name,repository,
                 branch,subdirectory,updated_at)
                 VALUES ('team-a',1,'Test',1,'Dev','example/team-a','main','', 'now')""")

    def test_no_repository_connection_leaks_or_mutates_other_team(self):
        with self.assertRaises(team_portal.PortalError):
            pc.verify_github_connection("team-c")
        self.assertIsNone(pc.connection_for("team-c"))
        self.assertFalse(pc.connection_for("team-a")["githubConnected"])

    def test_verification_persists_only_matching_repository_installation(self):
        with patch.dict(os.environ,{"GITHUB_APP_ID":"123","GITHUB_APP_SLUG":"test-app",
                                     "GITHUB_APP_PRIVATE_KEY_PATH":"/tmp/nonexistent.pem"}):
            with patch.object(github_app,"verify_repository",return_value=778) as verify:
                status=pc.verify_github_connection("team-a")
        verify.assert_called_once_with("example/team-a")
        self.assertTrue(status["connected"])
        self.assertTrue(pc.connection_for("team-a")["githubConnected"])

    def test_missing_app_configuration_is_actionable(self):
        with patch.dict(os.environ, {"GITHUB_APP_ID":"","GITHUB_APP_SLUG":"",
                                     "GITHUB_APP_PRIVATE_KEY_PATH":""}):
            with self.assertRaises(team_portal.PortalError) as caught:
                pc.verify_github_connection("team-a")
        self.assertEqual(caught.exception.status,503)
        self.assertIn("administrator",str(caught.exception))

    def test_app_install_url_only_uses_valid_slug(self):
        with patch.dict(os.environ,{"GITHUB_APP_ID":"123","GITHUB_APP_SLUG":"test-app",
                                     "GITHUB_APP_PRIVATE_KEY_PATH":"/tmp/nonexistent.pem"}):
            self.assertEqual(github_app.installation_url(),
                "https://github.com/apps/test-app/installations/new")
        with patch.dict(os.environ,{"GITHUB_APP_SLUG":"invalid/redirect"}):
            self.assertIsNone(github_app.installation_url())

if __name__ == "__main__":
    unittest.main()

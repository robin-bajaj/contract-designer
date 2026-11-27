"""Token-based GitHub connection tests. No live GitHub calls or real credentials."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server import project_connections as pc, team_portal

class GithubTokenConnectionTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        scope=patch.dict(os.environ, {"PORTAL_DB_PATH": str(Path(tmp.name)/"portal.sqlite3")})
        scope.start();self.addCleanup(scope.stop)
        self.db=Path(tmp.name)/"portal.sqlite3"
        with pc.connect() as db:
            db.execute("""INSERT INTO project_connections
            (role,project_id,project_name,environment_id,environment_name,repository,
             branch,subdirectory,updated_at)
             VALUES ('team-a',1,'Test',1,'Dev','example/team-a','main','', 'now')""")

    def test_connection_requires_dbt_link(self):
        with self.assertRaises(team_portal.PortalError):
            pc.connect_github_token("team-c","example-token")
        self.assertFalse(pc.github_connection_status("team-a")["connected"])

    def test_connection_verifies_contents_and_encrypts_token(self):
        token="github-test-secret-should-never-be-visible"
        paths=[]
        def request(path, credential):
            paths.append(path)
            self.assertEqual(credential,token)
            if path.endswith("/repos/example/team-a"):
                return {"full_name":"example/team-a","default_branch":"main"}
            if path.endswith("/git/trees/main?recursive=1"):
                return {"tree":[{"path":"dbt_project.yml","type":"blob"}]}
            raise AssertionError(path)
        with patch.object(pc,"_github_request",side_effect=request):
            status=pc.connect_github_token("team-a",token)
        self.assertEqual(len(paths),2)
        self.assertTrue(status["connected"])
        self.assertNotIn(token,self.db.read_bytes().decode("utf-8",errors="replace"))
        self.assertNotIn(token,str(status))
        self.assertEqual(pc._decrypt(pc.connect().execute(
            "SELECT github_token_ciphertext FROM project_connections WHERE role='team-a'").fetchone()[0]),token)

    def test_disconnect_removes_credential(self):
        with patch.object(pc,"_github_request",side_effect=[
            {"full_name":"example/team-a","default_branch":"main"},{"tree":[]}]):
            pc.connect_github_token("team-a","github-test-secret")
        status=pc.disconnect_github_token("team-a")
        self.assertFalse(status["connected"])
        self.assertFalse(pc.connection_for("team-a")["githubConnected"])

    def test_failed_verification_does_not_save_token(self):
        with patch.object(pc,"_github_request",side_effect=team_portal.PortalError("permission denied",403)):
            with self.assertRaises(team_portal.PortalError):
                pc.connect_github_token("team-a","invalid-token")
        self.assertFalse(pc.github_connection_status("team-a")["connected"])

    def test_read_only_api_uses_verified_token_and_not_other_repository(self):
        with patch.object(pc,"_github_request",side_effect=[
            {"full_name":"example/team-a","default_branch":"main"},{"tree":[]}]):
            pc.connect_github_token("team-a","verified-token")
        with patch.object(pc,"_github_request",return_value={"full_name":"example/team-a"}) as request:
            pc._github("/repos/example/team-a")
            request.assert_called_once_with("/repos/example/team-a","verified-token")
            pc._github("/repos/example/other")
            self.assertEqual(request.call_args.args[1],"")

if __name__ == "__main__":
    unittest.main()

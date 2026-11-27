"""Team lead dbt onboarding and encrypted Git discovery tests."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server import project_connections as pc, team_portal, dbt_cloud

TOKEN = "dbt-test-token-in-encrypted-store"
SHA, TREE_SHA = "a"*40, "b"*40
STAGE_A = "models/staging/team_a/stg_team_a_positions.sql"
FILE_A = "models/semantic_models/team_a/team_a_semantics.yml"
FILE_C = "models/semantic_models/team_c/team_c_semantics.yml"

def projects(c):
    assert c["token"] == TOKEN
    return {"data":[{"id":17,"name":"Equity dbt","repository_id":41}]}
def project(c,p):
    return {"data":{"id":p,"name":"Equity dbt","repository_id":41,"connection_id":21}}
def environments(c,p):
    return {"data":[{"id":101,"project_id":p,"name":"Dev"},{"id":102,"project_id":999,"name":"Other"}]}
def repository(c,p):
    return {"data":{"full_name":"robin-bajaj/federated-semantic-poc"}}
def github(path):
    import base64
    if path == "/repos/robin-bajaj/federated-semantic-poc":
        return {"full_name":"robin-bajaj/federated-semantic-poc","default_branch":"main"}
    if path.endswith("/branches/main"):
        return {"commit":{"sha":SHA,"commit":{"tree":{"sha":TREE_SHA}}}}
    if path.endswith("/git/trees/"+TREE_SHA+"?recursive=1"):
        return {"tree":[{"type":"blob","path":p} for p in
                        (STAGE_A, FILE_A, FILE_C, "dbt_project.yml",
                         "macros/date_helpers.sql", "seeds/products.csv",
                         "tests/assert_positions.sql", "secrets/credentials.yml")]}
    if "/contents/" in path:
        raw = ("version: 2\nmodels:\n  - name: a\n    config:\n      meta:\n        uses:\n          name: cdo.position\n          version: 1\n    semantic_model:\n      name: team_a\n" if FILE_A in path
               else "select 1 as position_id" if STAGE_A in path else "not: [valid")
        return {"type":"file","encoding":"base64","content":base64.b64encode(raw.encode()).decode()}
    raise AssertionError(path)

class TeamLeadConnectionTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.db=Path(temp.name)/"portal.sqlite3"
        p=patch.dict(os.environ,{"PORTAL_DB_PATH":str(self.db)})
        p.start(); self.addCleanup(p.stop)
        for name,func in [
            ("server.dbt_cloud.connected_projects",projects),
            ("server.dbt_cloud.connected_project",project),
            ("server.dbt_cloud.connected_environments",environments),
            ("server.dbt_cloud.connected_repository",repository),
            ("server.project_connections._github",github),
        ]:
            mocked=patch(name,side_effect=func)
            mocked.start();self.addCleanup(mocked.stop)
        self.payload={"role":"team-a","apiHost":"cloud.getdbt.com","accountId":123,"serviceToken":TOKEN}

    def test_only_known_team_roles_may_connect(self):
        for invalid in ("cdo", "unknown", "", None):
            with self.subTest(role=invalid), self.assertRaises(team_portal.PortalError):
                pc.require_team(invalid)
        pc.require_team("team-a")
        pc.require_team("team-c")

    def test_account_discovery_is_lead_gated_and_secret_free(self):
        with self.assertRaises(team_portal.PortalError):
            pc.preview_account("cdo",self.payload)
        choice=pc.preview_account("team-a",self.payload)
        self.assertEqual(choice["projects"][0]["name"],"Equity dbt")
        preview=pc.preview_project("team-a",{**self.payload,"projectId":17})
        self.assertEqual(preview["repository"],"robin-bajaj/federated-semantic-poc")
        self.assertEqual(len(preview["environments"]),1)
        self.assertNotIn(TOKEN,repr(choice)+repr(preview))

    def test_persists_encrypted_token_and_team_scoped_inventory(self):
        result=pc.assign("team-a",{**self.payload,"projectId":17,"environmentId":101})
        self.assertEqual(result["accountId"],123)
        self.assertNotIn(TOKEN,repr(result))
        self.assertNotIn(TOKEN,self.db.read_bytes().decode("utf8",errors="ignore"))
        self.assertEqual(pc.connection_secret("team-a")["token"],TOKEN)
        key=self.db.parent/"integrations.key"
        self.assertTrue(key.is_file())
        self.assertFalse(key.stat().st_mode & 0o077)
        catalog=pc.inventory("team-a")
        self.assertEqual(catalog["sources"],["stg_team_a_positions"])
        self.assertEqual(catalog["models"][0]["contract"]["name"],"cdo.position")
        self.assertIn("select 1",pc.model_file("team-a",STAGE_A)["content"])
        self.assertIn(FILE_C, catalog["files"])
        for path in ("dbt_project.yml", "macros/date_helpers.sql",
                     "seeds/products.csv", "tests/assert_positions.sql"):
            self.assertIn(path, catalog["files"])
        self.assertNotIn("secrets/credentials.yml", catalog["files"])
        self.assertTrue(pc.model_file("team-a", FILE_C)["content"])
        for file in ("secrets/credentials.yml","../models/staging/team_a/x.sql"):
            with self.assertRaises(team_portal.PortalError):
                pc.model_file("team-a",file)
        self.assertNotIn(TOKEN,repr(catalog))

    def test_wrong_environment_or_invalid_host_never_saves_token(self):
        with self.assertRaises(team_portal.PortalError):
            pc.assign("team-a",{**self.payload,"projectId":17,"environmentId":102})
        with self.assertRaises(team_portal.PortalError):
            pc.assign("cdo",{**self.payload,"projectId":17,"environmentId":101})
        for host in ("localhost","evil.example","https://cloud.getdbt.com","cloud.getdbt.com/path"):
            with self.assertRaises(dbt_cloud.DbtCloudError):
                pc.preview_account("team-a",{**self.payload,"apiHost":host})
        self.assertIsNone(pc.connection_for("team-a"))

    def test_team_c_malformed_yaml_does_not_hide_other_files(self):
        pc.assign("team-c",{**self.payload,"role":"team-c","projectId":17,"environmentId":101})
        self.assertEqual(pc.inventory("team-c")["models"],[{"file":FILE_C,"invalid":True}])

if __name__=="__main__":
    unittest.main()

class GithubAccessDiagnosticsTests(unittest.TestCase):
    def test_github_rate_limit_is_not_reported_as_missing_permission(self):
        from urllib.error import HTTPError
        from unittest.mock import patch
        from email.message import Message
        headers = Message()
        headers["X-RateLimit-Remaining"] = "0"
        def limited(*_args, **_kwargs):
            raise HTTPError("https://api.github.com/", 403, "rate limit", headers, None)
        with patch("server.project_connections.urlopen", side_effect=limited):
            with self.assertRaises(team_portal.PortalError) as caught:
                pc._github("/repos/example/test")
        self.assertEqual(caught.exception.status, 429)
        self.assertIn("rate limit", str(caught.exception).lower())
        self.assertNotIn("must grant", str(caught.exception))

    def test_bad_token_reports_authentication_not_rate_limit(self):
        from urllib.error import HTTPError
        from unittest.mock import patch
        def unauthorized(*_args, **_kwargs):
            raise HTTPError("https://api.github.com/", 401, "Unauthorized", {}, None)
        with patch("server.project_connections.urlopen", side_effect=unauthorized):
            with self.assertRaises(team_portal.PortalError) as caught:
                pc._github("/repos/example/test")
        self.assertEqual(caught.exception.status, 503)
        self.assertIn("rejected", str(caught.exception))

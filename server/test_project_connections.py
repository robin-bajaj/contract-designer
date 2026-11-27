"""Team lead dbt onboarding and encrypted Git discovery tests."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server import project_connections as pc, team_portal, dbt_cloud

TOKEN = "dbt-test-token-in-encrypted-store"
LEAD_A = "team-a-lead-private-access-code"
LEAD_C = "team-c-lead-private-access-code"
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
        return {"tree":[{"type":"blob","path":p} for p in (STAGE_A,FILE_A,FILE_C)]}
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
        p=patch.dict(os.environ,{"PORTAL_DB_PATH":str(self.db),
                                 "PORTAL_TEAM_A_LEAD_KEY":LEAD_A,
                                 "PORTAL_TEAM_C_LEAD_KEY":LEAD_C})
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

    def test_only_authorized_team_lead_may_connect(self):
        for wrong in (None,"","cdo",LEAD_C,"wrong"):
            with self.subTest(key=wrong),self.assertRaises(team_portal.PortalError):
                pc.require_lead("team-a",wrong)
        pc.require_lead("team-a",LEAD_A)
        with self.assertRaises(team_portal.PortalError):
            pc.require_lead("cdo",LEAD_A)

    def test_account_discovery_is_lead_gated_and_secret_free(self):
        with self.assertRaises(team_portal.PortalError):
            pc.preview_account("team-a",LEAD_C,self.payload)
        choice=pc.preview_account("team-a",LEAD_A,self.payload)
        self.assertEqual(choice["projects"][0]["name"],"Equity dbt")
        preview=pc.preview_project("team-a",LEAD_A,{**self.payload,"projectId":17})
        self.assertEqual(preview["repository"],"robin-bajaj/federated-semantic-poc")
        self.assertEqual(len(preview["environments"]),1)
        self.assertNotIn(TOKEN,repr(choice)+repr(preview))

    def test_persists_encrypted_token_and_team_scoped_inventory(self):
        result=pc.assign("team-a",LEAD_A,{**self.payload,"projectId":17,"environmentId":101})
        self.assertEqual(result["accountId"],123)
        self.assertNotIn(TOKEN,repr(result))
        self.assertNotIn(TOKEN,self.db.read_bytes().decode("utf8",errors="ignore"))
        self.assertEqual(pc.connection_secret("team-a",LEAD_A)["token"],TOKEN)
        key=self.db.parent/"integrations.key"
        self.assertTrue(key.is_file())
        self.assertFalse(key.stat().st_mode & 0o077)
        catalog=pc.inventory("team-a")
        self.assertEqual(catalog["sources"],["stg_team_a_positions"])
        self.assertEqual(catalog["models"][0]["contract"]["name"],"cdo.position")
        self.assertIn("select 1",pc.model_file("team-a",STAGE_A)["content"])
        for file in (FILE_C,"secrets/credentials.yml","../models/staging/team_a/x.sql"):
            with self.assertRaises(team_portal.PortalError):
                pc.model_file("team-a",file)
        self.assertNotIn(TOKEN,repr(catalog))

    def test_wrong_environment_or_invalid_host_never_saves_token(self):
        with self.assertRaises(team_portal.PortalError):
            pc.assign("team-a",LEAD_A,{**self.payload,"projectId":17,"environmentId":102})
        with self.assertRaises(team_portal.PortalError):
            pc.assign("team-c",LEAD_A,{**self.payload,"projectId":17,"environmentId":101})
        for host in ("localhost","evil.example","https://cloud.getdbt.com","cloud.getdbt.com/path"):
            with self.assertRaises(dbt_cloud.DbtCloudError):
                pc.preview_account("team-a",LEAD_A,{**self.payload,"apiHost":host})
        self.assertIsNone(pc.connection_for("team-a"))

    def test_team_c_malformed_yaml_does_not_hide_other_files(self):
        pc.assign("team-c",LEAD_C,{**self.payload,"role":"team-c","projectId":17,"environmentId":101})
        self.assertEqual(pc.inventory("team-c")["models"],[{"file":FILE_C,"invalid":True}])

if __name__=="__main__":
    unittest.main()

"""Mocked GitHub publication tests: no network, no credentials."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import os
from server import github_publish as pub, project_connections as pc, team_portal

SHA="a"*40
TREE="b"*40
NEWTREE="c"*40
NEWCOMMIT="d"*40
YAML="version: 2\nmodels:\n  - name: team_a_new\n    semantic_model:\n      name: equity_new\n"
DRAFT={"role":"team-a","id":"12345678-1111-4111-8111-111111111111",
       "semanticName":"equity_new","sourceModel":"team_a_new",
       "sourceMode":"new","sourceSql":"select 1 as position_id"}

class PublishToGithubTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        patcher=patch.dict(os.environ,{"PORTAL_DB_PATH":str(Path(temp.name)/"portal.sqlite3")})
        patcher.start();self.addCleanup(patcher.stop)
        with pc.connect() as db:
            db.execute("""INSERT INTO project_connections
               (role,project_id,project_name,environment_id,environment_name,repository,
                branch,subdirectory,updated_at,github_token_ciphertext)
               VALUES ('team-a',1,'Test',1,'Dev','example/team-a','main','', 'now', ?)""",
               (pc._encrypt("test-secret"),))

    def fake_requests(self, existing=()):
        calls=[]
        def fake(repo,endpoint,token,*,method="GET",data=None):
            self.assertEqual(repo,"example/team-a")
            self.assertEqual(token,"test-secret")
            calls.append((endpoint,method,data))
            if endpoint=="/branches/main": return {"commit":{"sha":SHA}}
            if endpoint=="/git/commits/"+SHA: return {"tree":{"sha":TREE}}
            if endpoint=="/git/trees/"+TREE+"?recursive=1":
                return {"tree":[{"path":p,"type":"blob"} for p in existing]}
            if endpoint=="/git/trees" and method=="POST": return {"sha":NEWTREE}
            if endpoint=="/git/commits" and method=="POST": return {"sha":NEWCOMMIT}
            if endpoint=="/git/refs" and method=="POST": return {"ref":"refs/heads/new"}
            if endpoint=="/pulls" and method=="POST":
                return {"html_url":"https://github.com/example/team-a/pull/5","number":5}
            raise AssertionError((endpoint,method))
        return calls,fake

    def test_new_model_creates_atomic_commit_feature_branch_and_pr(self):
        calls,fake=self.fake_requests()
        with patch.object(pub,"_request",side_effect=fake):
            result=pub.publish(DRAFT,YAML)
        self.assertEqual(result["status"],"pr-open")
        self.assertEqual(result["prNumber"],5)
        self.assertEqual(result["base"],"main")
        paths=result["paths"]
        self.assertEqual(set(paths),{"models/staging/team_a/team_a_new.sql",
                                     "models/semantic_models/team_a/equity_new.yml"})
        tree=next(data for endpoint,method,data in calls if endpoint=="/git/trees" and method=="POST")
        self.assertEqual({item["path"]:item["content"] for item in tree["tree"]},
                         {paths[0]:YAML,paths[1]:"select 1 as position_id"})
        ref=next(data for endpoint,method,data in calls if endpoint=="/git/refs" and method=="POST")
        self.assertTrue(ref["ref"].startswith("refs/heads/portal/team_a/"))
        pr=next(data for endpoint,method,data in calls if endpoint=="/pulls" and method=="POST")
        self.assertEqual(pr["base"],"main")
        self.assertEqual(pr["head"],result["branch"])

    def test_existing_sql_can_be_referenced_without_modifying_it(self):
        sql="models/staging/team_a/team_a_new.sql"
        calls,fake=self.fake_requests(existing=(sql,))
        existing={**DRAFT,"sourceMode":"existing","sourceSql":None}
        with patch.object(pub,"_request",side_effect=fake):
            result=pub.publish(existing,YAML)
        self.assertEqual(result["paths"],["models/semantic_models/team_a/equity_new.yml"])

    def test_no_write_if_remote_file_already_exists(self):
        calls,fake=self.fake_requests(existing=("models/staging/team_a/team_a_new.sql",))
        with patch.object(pub,"_request",side_effect=fake):
            with self.assertRaisesRegex(team_portal.PortalError,"already exist"):
                pub.publish(DRAFT,YAML)
        self.assertFalse(any(method=="POST" for _,method,_ in calls))

    def test_no_write_if_existing_source_absent(self):
        calls,fake=self.fake_requests()
        with patch.object(pub,"_request",side_effect=fake):
            with self.assertRaisesRegex(team_portal.PortalError,"missing"):
                pub.publish({**DRAFT,"sourceMode":"existing","sourceSql":None},YAML)
        self.assertFalse(any(method=="POST" for _,method,_ in calls))

    def test_no_publication_without_connected_token(self):
        with pc.connect() as db:
            db.execute("UPDATE project_connections SET github_token_ciphertext=NULL WHERE role='team-a'")
        calls,fake=self.fake_requests()
        with patch.object(pub,"_request",side_effect=fake):
            with self.assertRaisesRegex(team_portal.PortalError,"Connect GitHub"):
                pub.publish(DRAFT,YAML)
        self.assertEqual(calls,[])

    def test_only_team_owned_paths_are_generated(self):
        calls,fake=self.fake_requests()
        with pc.connect() as db:
            db.execute("""INSERT INTO project_connections
               (role,project_id,project_name,environment_id,environment_name,repository,
                branch,subdirectory,updated_at,github_token_ciphertext)
               VALUES ('team-c',1,'Other',1,'Dev','example/other','main','', 'now', ?)""",
               (pc._encrypt("different-secret"),))
        with patch.object(pub,"_request",side_effect=fake):
            result=pub.publish(DRAFT,YAML)
        self.assertTrue(all(path.startswith(("models/staging/team_a/","models/semantic_models/team_a/"))
                            for path in result["paths"]))

if __name__=="__main__":
    unittest.main()

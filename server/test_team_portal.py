"""Local portal persistence and validation-gated GitHub PR publication tests."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server import team_portal as portal

YAML = """version: 2
models:
  - name: team_a_new
    description: An equity model
    semantic_model:
      enabled: true
      name: equity_new
"""

def payload(role="team-a"):
    return {"role":role,"sourceModel":"team_a_new" if role=="team-a" else "team_c_new",
            "semanticName":"equity_new" if role=="team-a" else "fi_new",
            "sourceMode":"new","sourceSql":"select 1 as position_id",
            "yamlText":YAML.replace("team_a_new","team_c_new").replace("equity_new","fi_new") if role=="team-c" else YAML,
            "draftData":{"description":"Test editor values"}}

class PortalTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base=Path(self.temp.name)
        patcher=patch.dict("os.environ",{"PORTAL_DB_PATH":str(base/"portal.sqlite"),
                                         "DBT_PROJECT_PATH":""})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.project=portal.project_path()
        self.assertTrue((self.project/"dbt_project.yml").exists())

    def test_save_incomplete_draft_then_resume(self):
        draft=portal.save_draft({"role":"team-a","sourceModel":"team_a_new","semanticName":"",
            "sourceMode":"new","sourceSql":"select","yamlText":"","draftData":{"description":"unfinished"}})
        self.assertEqual(draft["status"],"draft")
        self.assertEqual(draft["draftData"]["description"],"unfinished")
        self.assertEqual(len(portal.list_drafts("team-a")),1)
        self.assertEqual(portal.list_drafts("team-c"),[])
        self.assertEqual(portal.load_draft(draft["id"])["id"],draft["id"])

    def test_validation_then_publish_opens_github_pr_without_writing_local_files(self):
        draft=portal.save_draft(payload())
        with self.assertRaisesRegex(portal.PortalError,"Validate"):
            portal.publish_draft(draft["id"])
        compiled=YAML.replace("description: An equity model","description: Native compiled model")
        validated=portal.mark_validated(draft["id"],{"ok":True,"compiledYaml":compiled,"validationRevision":"a"*40,"validatedRepository":"example/team-a"})
        self.assertEqual(validated["status"],"validated")
        response={"status":"pr-open","repository":"example/team-a",
                  "prUrl":"https://github.com/example/team-a/pull/22",
                  "prNumber":22,"paths":["models/staging/team_a/team_a_new.sql",
                                     "models/semantic_models/team_a/equity_new.yml"]}
        with patch("server.github_publish.publish",return_value=response) as publish:
            result=portal.publish_draft(draft["id"])
        publish.assert_called_once()
        self.assertEqual(publish.call_args.args[1],YAML)
        self.assertEqual(publish.call_args.kwargs["expected_revision"],"a"*40)
        self.assertEqual(result["status"],"pr-open")
        self.assertEqual(portal.load_draft(draft["id"])["status"],"submitted")
        self.assertEqual(portal.load_draft(draft["id"])["prUrl"],response["prUrl"])
        self.assertFalse((self.project/"models/staging/team_a/team_a_new.sql").exists())
        with self.assertRaisesRegex(portal.PortalError,"already submitted"):
            portal.publish_draft(draft["id"])
        with self.assertRaisesRegex(portal.PortalError,"already has a GitHub PR"):
            portal.save_draft({**payload(),"id":draft["id"]})

    def test_changes_invalidate_validated_revision_and_block_publish(self):
        saved=portal.save_draft(payload())
        portal.mark_validated(saved["id"],{"ok":True,"compiledYaml":YAML,"validationRevision":"a"*40,"validatedRepository":"example/team-a"})
        changed=portal.save_draft({**payload(),"id":saved["id"],"sourceSql":"select 2 as position_id"})
        self.assertEqual(changed["status"],"draft")
        with self.assertRaisesRegex(portal.PortalError,"Validate"):
            portal.publish_draft(saved["id"])

    def test_reject_cross_team_draft_update(self):
        saved=portal.save_draft(payload())
        with self.assertRaisesRegex(portal.PortalError,"another team's draft"):
            portal.save_draft({**payload("team-c"),"id":saved["id"]})

    def test_remote_publish_failure_leaves_draft_validated(self):
        saved=portal.save_draft(payload())
        portal.mark_validated(saved["id"],{"ok":True,"compiledYaml":YAML,"validationRevision":"a"*40,"validatedRepository":"example/team-a"})
        with patch("server.github_publish.publish",
                   side_effect=portal.PortalError("GitHub permission denied",403)):
            with self.assertRaisesRegex(portal.PortalError,"GitHub permission denied"):
                portal.publish_draft(saved["id"])
        self.assertEqual(portal.load_draft(saved["id"])["status"],"validated")

    def test_published_sql_is_discoverable_as_source(self):
        saved=portal.save_draft(payload())
        portal.mark_validated(saved["id"],{"ok":True,"compiledYaml":YAML,"validationRevision":"a"*40,"validatedRepository":"example/team-a"})
        with patch("server.github_publish.publish",return_value={
            "status":"pr-open","prUrl":"https://github.com/example/team-a/pull/22",
            "prNumber":22}):
            portal.publish_draft(saved["id"])
        self.assertIn("team_a_new",portal.source_models("team-a"))

if __name__=="__main__":
    unittest.main()

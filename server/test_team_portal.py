"""Local portal persistence and validation-gated publication tests."""
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
        self.project=base/"target_project"
        self.project.mkdir()
        (self.project/"dbt_project.yml").write_text("name: portal_poc\nprofile: portal_poc\n")
        patcher=patch.dict("os.environ",{"PORTAL_DB_PATH":str(base/"portal.sqlite"),
                                         "DBT_PROJECT_PATH":str(self.project)})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_save_incomplete_draft_then_resume(self):
        draft=portal.save_draft({"role":"team-a","sourceModel":"team_a_new","semanticName":"",
            "sourceMode":"new","sourceSql":"select","yamlText":"","draftData":{"description":"unfinished"}})
        self.assertEqual(draft["status"],"draft")
        self.assertEqual(draft["draftData"]["description"],"unfinished")
        self.assertEqual(len(portal.list_drafts("team-a")),1)
        self.assertEqual(portal.list_drafts("team-c"),[])
        self.assertEqual(portal.load_draft(draft["id"])["id"],draft["id"])

    def test_validation_then_publish_writes_native_files_only_to_target_project(self):
        draft=portal.save_draft(payload())
        with self.assertRaisesRegex(portal.PortalError,"Validate"):
            portal.publish_draft(draft["id"])
        compiled=YAML.replace("description: An equity model","description: Native compiled model")
        validated=portal.mark_validated(draft["id"],{"ok":True,"compiledYaml":compiled})
        self.assertEqual(validated["status"],"validated")
        result=portal.publish_draft(draft["id"])
        self.assertEqual(result["status"],"published-local")
        self.assertEqual((self.project/"models/staging/team_a/team_a_new.sql").read_text(),
                         "select 1 as position_id")
        self.assertEqual((self.project/"models/semantic_models/team_a/equity_new.yml").read_text(),compiled)
        self.assertEqual(portal.load_draft(draft["id"])["status"],"published")
        with self.assertRaisesRegex(portal.PortalError,"already exists"):
            portal.publish_draft(draft["id"])

    def test_changes_invalidate_validated_revision_and_block_publish(self):
        saved=portal.save_draft(payload())
        portal.mark_validated(saved["id"],{"ok":True,"compiledYaml":YAML})
        changed=portal.save_draft({**payload(),"id":saved["id"],"sourceSql":"select 2 as position_id"})
        self.assertEqual(changed["status"],"draft")
        with self.assertRaisesRegex(portal.PortalError,"Validate"):
            portal.publish_draft(saved["id"])

    def test_reject_cross_team_draft_update(self):
        saved=portal.save_draft(payload())
        with self.assertRaisesRegex(portal.PortalError,"another team's draft"):
            portal.save_draft({**payload("team-c"),"id":saved["id"]})

    def test_no_valid_db_project_rejects_publication(self):
        saved=portal.save_draft(payload())
        portal.mark_validated(saved["id"],{"ok":True,"compiledYaml":YAML})
        with patch.dict("os.environ",{"DBT_PROJECT_PATH":""}):
            with self.assertRaisesRegex(portal.PortalError,"DBT_PROJECT_PATH"):
                portal.publish_draft(saved["id"])

    def test_published_sql_is_discoverable_as_source(self):
        saved=portal.save_draft(payload())
        portal.mark_validated(saved["id"],{"ok":True,"compiledYaml":YAML})
        portal.publish_draft(saved["id"])
        self.assertEqual(portal.source_models("team-a"),["team_a_new"])

if __name__=="__main__":
    unittest.main()

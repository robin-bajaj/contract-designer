"""Fast dbt Core tests using a configured disposable local project."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server.fast_validate import InputError, validate_dbt, validate_payload, check_staging_sql

YAML = """version: 2
models:
  - name: new_team_a
    description: Test
    semantic_model:
      enabled: true
      name: new_team_a_semantics
"""
PAYLOAD = {
    "role": "team-a", "sourceModel": "new_team_a",
    "semanticName": "new_team_a_semantics",
    "sourceMode": "new", "sourceSql": "select 1 as position_id",
    "yamlText": YAML,
}

class FastValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        from server.team_portal import project_path
        patcher = patch.dict("os.environ", {
            "PORTAL_DB_PATH": str(Path(self.temp.name) / "portal.sqlite3"),
            "DBT_PROJECT_PATH": "",
        })
        patcher.start()
        self.addCleanup(patcher.stop)
        self.project = project_path()

    def test_accepts_payload(self):
        self.assertEqual(validate_payload(PAYLOAD)["team"],"team_a")

    def test_rejects_invalid_identifiers_and_mismatched_yaml(self):
        for override in ({"role":"cdo"},{"sourceModel":"../config"},{"semanticName":"x/../../y"},
                         {"sourceModel":"not_in_yaml"}):
            with self.subTest(override=override):
                with self.assertRaises(InputError):
                    validate_payload({**PAYLOAD,**override})

    def test_parse_overlays_unsaved_files_without_touching_source_project(self):
        steps=[]
        def runner(name,argv,cwd,env=None,timeout=65):
            steps.append(name)
            self.assertNotIn("federated-semantic-poc"," ".join(argv))
            if name=="dbt Core parse":
                project=Path(cwd)
                self.assertEqual((project/"models/staging/team_a/new_team_a.sql").read_text(),PAYLOAD["sourceSql"])
                self.assertEqual((project/"models/semantic_models/team_a/new_team_a_semantics.yml").read_text(),YAML)
                (project/"target").mkdir()
                (project/"target/manifest.json").write_text("{}")
                self.assertIn("semantic_portal:",(project/".ci/profiles.yml").read_text())
            return "ok"
        with patch("server.fast_validate.shutil.which",return_value="/usr/bin/dbt"):
            result=validate_dbt(PAYLOAD,runner=runner)
        self.assertTrue(result["ok"],result)
        self.assertEqual(steps,["dbt Core parse"])
        self.assertEqual(result["compiledYaml"],YAML)
        self.assertFalse((self.project/"models/staging/team_a/new_team_a.sql").exists())

    def test_existing_source_must_exist_locally(self):
        result=validate_dbt({**PAYLOAD,"sourceMode":"existing","sourceSql":None},
                            runner=lambda *a,**kw:"ok")
        self.assertFalse(result["ok"])
        self.assertIn("not in this team's staging folder",result["error"])

    def test_postgres_syntax_smoke(self):
        check_staging_sql("select position_id from positions")
        with self.assertRaises(InputError):
            check_staging_sql("SELECTertygrab")
        with self.assertRaises(InputError):
            check_staging_sql("select from")

    def test_invalid_sql_short_circuits_before_dbt(self):
        draft={"validationScope":"staging","role":"team-a","sourceModel":"new_team_a",
               "sourceMode":"new","sourceSql":"SELECTertygrab"}
        def forbid(*args,**kwargs):
            self.fail("Invalid SQL should fail before dbt")
        result=validate_dbt(draft,runner=forbid)
        self.assertFalse(result["ok"])
        self.assertEqual(result["steps"][0]["name"],"SQL syntax")

    def test_staging_only_works_without_semantic_yaml(self):
        draft={"validationScope":"staging","role":"team-c","sourceModel":"new_fi",
               "sourceMode":"new","sourceSql":"select 1 as n"}
        seen=[]
        def runner(name,argv,cwd,env=None,timeout=65):
            seen.append(name)
            if name=="dbt Core parse":
                project=Path(cwd)
                self.assertTrue((project/"models/staging/team_c/new_fi.sql").is_file())
                (project/"target").mkdir()
                (project/"target/manifest.json").write_text("{}")
            return "ok"
        with patch("server.fast_validate.shutil.which",return_value="/usr/bin/dbt"):
            result=validate_dbt(draft,runner=runner)
        self.assertTrue(result["ok"],result)
        self.assertEqual(seen,["dbt Core parse"])

    def test_validation_auto_provisions_workspace_without_environment_setup(self):
        with patch.dict("os.environ",{"DBT_PROJECT_PATH":"/nonexistent/old-project"}):
            self.assertTrue((self.project/"dbt_project.yml").is_file())
            self.assertTrue((self.project/"models/groups.yml").is_file())
        steps=[]
        def runner(name,argv,cwd,env=None,timeout=65):
            steps.append(name)
            if name=="dbt Core parse":
                folder=Path(cwd)/"target"
                folder.mkdir()
                (folder/"manifest.json").write_text("{}")
            return "ok"
        with patch("server.fast_validate.shutil.which",return_value="/usr/bin/dbt"):
            result=validate_dbt(PAYLOAD,runner=runner)
        self.assertTrue(result["ok"],result)
        self.assertEqual(steps,["dbt Core parse"])

if __name__=="__main__":
    unittest.main()

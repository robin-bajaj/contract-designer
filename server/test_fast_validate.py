"""Fast dbt Core tests using a configured disposable local project."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server.fast_validate import InputError, StepFailure, validate_dbt, validate_payload, check_staging_sql

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


    def test_invalid_local_governance_path_falls_back_to_approved_registry(self):
        inherited = """version: 2
models:
  - name: new_team_a
    description: Model with inherited CDO definitions
    config:
      meta:
        uses:
          name: cdo.position
          version: 1
        include:
          attributes:
            - name: position_id
            - name: profit_loss
          metrics:
            - name: total_profit_loss
              alias: equity_profit_loss
    semantic_model:
      enabled: true
      name: new_team_a_semantics
"""
        calls = []
        def runner(name, argv, cwd, env=None, timeout=65):
            calls.append(name)
            if name == "Load approved CDO contracts":
                self.assertIn("cdo-semantic-governance.git", " ".join(argv))
                target = Path(argv[-1])
                (target / "contracts").mkdir(parents=True)
                (target / "src").mkdir()
            if name == "CDO inheritance compiler":
                path = Path(cwd)/"models/semantic_models/team_a/new_team_a_semantics.yml"
                self.assertIn("cdo.position", path.read_text())
                path.write_text(YAML)
            if name == "dbt Core parse":
                manifest = Path(cwd) / "target"
                manifest.mkdir()
                (manifest / "manifest.json").write_text("{}")
            return "ok"
        with patch.dict("os.environ", {"CDO_GOVERNANCE_PATH": "/missing/local/governance"}):
            with patch("server.fast_validate.shutil.which", return_value="/usr/local/bin/dbt"):
                result = validate_dbt({**PAYLOAD, "yamlText": inherited}, runner=runner)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["compiledYaml"], YAML)
        self.assertEqual(calls, ["Load approved CDO contracts", "CDO registry validation",
                                 "CDO inheritance compiler", "dbt Core parse"])
        self.assertIn({"name": "Load approved CDO contracts", "status": "passed"}, result["steps"])

    def test_valid_local_governance_checkout_is_used_without_cloning(self):
        folder = Path(self.temp.name)/"governance"
        (folder/"src").mkdir(parents=True)
        (folder/"contracts").mkdir()
        inherited = YAML.replace("    semantic_model:", """    config:
      meta:
        uses:
          name: cdo.position
          version: 1
    semantic_model:""")
        calls = []
        def runner(name, argv, cwd, env=None, timeout=65):
            calls.append(name)
            if name == "CDO inheritance compiler":
                self.assertEqual(env["PYTHONPATH"].split(":")[0], str(folder/"src"))
            if name == "dbt Core parse":
                target = Path(cwd)/"target"
                target.mkdir()
                (target/"manifest.json").write_text("{}")
            return "ok"
        with patch.dict("os.environ", {"CDO_GOVERNANCE_PATH": str(folder)}):
            with patch("server.fast_validate.shutil.which", return_value="/usr/local/bin/dbt"):
                result = validate_dbt({**PAYLOAD, "yamlText": inherited}, runner=runner)
        self.assertTrue(result["ok"], result)
        self.assertNotIn("Load approved CDO contracts", calls)

    def test_missing_ref_error_explains_portal_dependent_model(self):
        def runner(name, argv, cwd, env=None, timeout=65):
            if name == "dbt Core parse":
                raise StepFailure(name, "Compilation Error: Model depends on a node named 'team_a_positions' which was not found")
            return "ok"
        with patch("server.fast_validate.shutil.which", return_value="/usr/local/bin/dbt"):
            result = validate_dbt(PAYLOAD, runner=runner)
        self.assertFalse(result["ok"])
        self.assertIn("team_a_positions", result["error"])
        self.assertIn("connected dbt project", result["hint"])
        self.assertEqual(result["steps"][-1], {"name": "dbt Core parse", "status": "failed"})

if __name__=="__main__":
    unittest.main()

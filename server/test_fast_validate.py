"""Offline tests: fake dbt and git processes; no network or dbt installation needed."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server.fast_validate import InputError, validate_dbt, validate_payload

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
    def test_accepts_unsaved_sql_and_semantic_yaml(self):
        self.assertEqual(validate_payload(PAYLOAD)["team"], "team_a")

    def test_rejects_path_traversal_and_unknown_team(self):
        for override in ({"role": "cdo"}, {"sourceModel": "../config"},
                         {"semanticName": "x/../../y"}):
            with self.subTest(override=override):
                with self.assertRaises(InputError):
                    validate_payload({**PAYLOAD, **override})

    def test_rejects_mismatched_yaml(self):
        with self.assertRaises(InputError):
            validate_payload({**PAYLOAD, "sourceModel": "not_in_yaml"})

    def test_parse_success_runs_real_command_names_and_overlays_unsaved_files(self):
        steps = []

        def mock_runner(name, argv, cwd, env=None, timeout=65):
            steps.append((name, argv))
            if name == "Checkout dbt project":
                project = Path(argv[-1])
                (project / "models/staging/team_a").mkdir(parents=True)
            if name == "Checkout CDO registry":
                Path(argv[-1]).mkdir(parents=True)
            if name == "dbt Core parse":
                project = Path(cwd)
                sql = project / "models/staging/team_a/new_team_a.sql"
                yml = project / "models/semantic_models/team_a/new_team_a_semantics.yml"
                self.assertEqual(sql.read_text(), PAYLOAD["sourceSql"])
                self.assertEqual(yml.read_text(), YAML)
                (project / "target").mkdir()
                (project / "target/manifest.json").write_text("{}")
            return "ok"

        with patch("server.fast_validate.shutil.which", side_effect=lambda name: "/bin/dbt" if name == "dbt" else "/usr/bin/python3"):
            result = validate_dbt(PAYLOAD, runner=mock_runner)
        self.assertTrue(result["ok"], result)
        self.assertEqual([name for name, _ in steps], [
            "Checkout dbt project", "Checkout CDO registry",
            "CDO registry validation", "CDO inheritance compiler", "dbt Core parse",
        ])

    def test_existing_source_model_cannot_be_replaced(self):
        data = {**PAYLOAD, "sourceMode": "existing", "sourceSql": None}

        def mock_runner(name, argv, cwd, env=None, timeout=65):
            if name == "Checkout dbt project":
                Path(argv[-1]).mkdir()
            if name == "Checkout CDO registry":
                Path(argv[-1]).mkdir()
            return "ok"

        result = validate_dbt(data, runner=mock_runner)
        self.assertFalse(result["ok"])
        self.assertIn("not in this team's staging folder", result["error"])


    def test_staging_only_accepts_sql_before_semantic_model_is_defined(self):
        draft = { "validationScope":"staging", "role":"team-a",
                  "sourceModel":"new_team_a", "sourceMode":"new",
                  "sourceSql":"select 1 as position_id" }
        result=validate_payload(draft)
        self.assertTrue(result["stage_only"])
        self.assertIsNone(result["yaml"])

    def test_staging_only_parses_current_unsaved_sql_without_yaml(self):
        draft = { "validationScope":"staging", "role":"team-c",
                  "sourceModel":"stg_new_fi", "sourceMode":"new",
                  "sourceSql":"select {{ ref('a') }} as demo" }
        seen=[]
        def runner(name, argv, cwd, env=None, timeout=65):
            seen.append(name)
            if name=="Checkout dbt project":
                (Path(argv[-1])/"models/staging/team_c").mkdir(parents=True)
            if name=="Checkout CDO registry":
                Path(argv[-1]).mkdir(parents=True)
            if name=="dbt Core parse":
                project=Path(cwd)
                self.assertEqual((project/"models/staging/team_c/stg_new_fi.sql").read_text(),draft["sourceSql"])
                self.assertFalse((project/"models/semantic_models/team_c/stg_new_fi.yml").exists())
                (project/"target").mkdir()
                (project/"target/manifest.json").write_text("{}")
            return "ok"
        with patch("server.fast_validate.shutil.which",side_effect=lambda _: "/usr/bin/dbt"):
            result=validate_dbt(draft,runner=runner)
        self.assertTrue(result["ok"],result)
        self.assertEqual(result["scope"],"staging")
        self.assertIn("CDO inheritance compiler",seen)
        self.assertIn("dbt Core parse",seen)

    def test_staging_only_rejects_path_traversal(self):
        with self.assertRaises(InputError):
            validate_payload({"validationScope":"staging","role":"team-a",
                "sourceModel":"../escape","sourceMode":"new","sourceSql":"select 1"})


if __name__ == "__main__":
    unittest.main()

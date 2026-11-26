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


if __name__ == "__main__":
    unittest.main()

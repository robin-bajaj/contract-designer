"""Actual CDO inheritance compiler + dbt Core parser integration smoke.

Runs on GitHub Actions (with network access to the approved governance repo).
Unit tests cover these paths with a fake runner for offline local development.
"""
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
from server.fast_validate import validate_dbt

CDO_YAML = """version: 2
models:
  - name: stg_team_a_inheritance_smoke
    description: Team A positions inherited from approved CDO Position
    config:
      group: lob_team_a
      access: protected
      contract:
        enforced: true
      meta:
        uses:
          name: cdo.position
          version: 1
        include:
          attributes:
            - name: position_id
              entity:
                name: team_a_position
                type: primary
            - name: report_date
              dimension:
                type: time
              granularity: day
            - name: profit_loss
            - name: instrument_code
              entity:
                name: instrument
                type: foreign
          metrics:
            - name: total_profit_loss
              alias: equity_profit_loss
    semantic_model:
      enabled: true
      name: team_a_inheritance_smoke
    agg_time_dimension: report_date
    columns:
      - name: mtm
        data_type: numeric
      - name: cash
        data_type: numeric
    metrics:
      - name: team_a_position_count
        type: simple
        agg: count
        expr: position_id
"""

CDO_SQL = """select
  'EQ-001'::text as position_id,
  current_date as report_date,
  150.25::numeric as profit_loss,
  125.50::numeric as mtm,
  50.00::numeric as cash,
  1001::integer as instrument_code
"""


@unittest.skipUnless(os.environ.get("GITHUB_ACTIONS") and shutil.which("dbt") and shutil.which("git"),
                     "Real governance/dbt smoke runs in GitHub CI")
class InheritanceIntegrationTests(unittest.TestCase):
    def test_approved_contract_inheritance_compiles_and_dbt_parses(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(os.environ, {
                "PORTAL_DB_PATH": str(Path(tmp)/"portal.sqlite3"),
                "CDO_GOVERNANCE_PATH": str(Path(tmp)/"not-a-checkout"),
            }):
                result = validate_dbt({
                    "role": "team-a",
                    "sourceModel": "stg_team_a_inheritance_smoke",
                    "semanticName": "team_a_inheritance_smoke",
                    "sourceMode": "new",
                    "sourceSql": CDO_SQL,
                    "yamlText": CDO_YAML,
                })
            self.assertTrue(result["ok"], result)
            compiled = result["compiledYaml"]
            self.assertIn("equity_profit_loss", compiled)
            self.assertIn("position_id", compiled)
            self.assertIn("report_date", compiled)
            self.assertIn("mtm", compiled)
            self.assertNotIn("uses:", compiled)
            self.assertIn("CDO inheritance compiler", [step["name"] for step in result["steps"]])
            self.assertIn("dbt Core parse", [step["name"] for step in result["steps"]])


if __name__=="__main__":
    unittest.main()

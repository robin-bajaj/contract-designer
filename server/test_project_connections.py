"""dbt Cloud project connection and Git inventory tests; no real credentials."""
import base64
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from server import project_connections as pc, team_portal

SHA = "a" * 40
TREE_SHA = "b" * 40
YAML = """version: 2
models:
  - name: stg_team_a_positions
    description: Existing equity positions
    config:
      meta:
        uses:
          name: cdo.position
          version: 1
    semantic_model:
      enabled: true
      name: team_a_equity_positions
"""
SQL = "select 1 as position_id"
FILE_A = "models/semantic_models/team_a/team_a_semantics.yml"
STAGE_A = "models/staging/team_a/stg_team_a_positions.sql"
FILE_C = "models/semantic_models/team_c/team_c_semantics.yml"


def projects():
    return {"data": [
        {"id": 17, "name": "Equity dbt", "repository_id": 41, "connection_id": 21},
        {"id": 18, "name": "Other dbt", "repository_id": None},
    ]}


def project(project_id):
    return {"data": {
        "id": project_id, "name": "Equity dbt",
        "repository_id": 41, "connection_id": 21,
        "dbt_project_subdirectory": "",
    }}


def environments(project_id):
    return {"data": [
        {"id": 101, "project_id": project_id, "name": "Development", "type": "development"},
        {"id": 102, "project_id": 999, "name": "Other project"},
    ]}


def repository(repo_id):
    return {"data": {"full_name": "robin-bajaj/federated-semantic-poc"}}


def github(path):
    if path == "/repos/robin-bajaj/federated-semantic-poc":
        return {"full_name": "robin-bajaj/federated-semantic-poc", "default_branch": "main"}
    if path.endswith("/branches/main"):
        return {"commit": {"sha": SHA, "commit": {"tree": {"sha": TREE_SHA}}}}
    if path.endswith(f"/git/trees/{TREE_SHA}?recursive=1"):
        return {"truncated": False, "tree": [
            {"path": STAGE_A, "type": "blob"},
            {"path": FILE_A, "type": "blob"},
            {"path": FILE_C, "type": "blob"},
            {"path": "models/staging/team_c/stg_team_c_positions.sql", "type": "blob"},
            {"path": "secrets/passwords.txt", "type": "blob"},
        ]}
    if "/contents/" in path and STAGE_A in path:
        return {"type": "file", "encoding": "base64",
                "content": base64.b64encode(SQL.encode()).decode()}
    if "/contents/" in path and FILE_A in path:
        return {"type": "file", "encoding": "base64",
                "content": base64.b64encode(YAML.encode()).decode()}
    if "/contents/" in path and FILE_C in path:
        return {"type": "file", "encoding": "base64",
                "content": base64.b64encode(b"not: [valid yaml").decode()}
    raise AssertionError(f"Unexpected GitHub API path {path}")


class ConnectedProjectTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        p = patch.dict(os.environ, {
            "PORTAL_DB_PATH": str(Path(tmp.name) / "drafts.sqlite3"),
            "PORTAL_ADMIN_KEY": "administrator-test-key",
            "DBT_CLOUD_TOKEN": "super-secret-dbt-api-token",
            "PORTAL_GITHUB_READ_TOKEN": "super-secret-github-token",
        })
        p.start()
        self.addCleanup(p.stop)
        for module, name, replacement in [
            ("server.dbt_cloud", "projects", projects),
            ("server.dbt_cloud", "project", project),
            ("server.dbt_cloud", "environments", environments),
            ("server.dbt_cloud", "repository", repository),
            ("server.project_connections", "_github", github),
        ]:
            patcher=patch(f"{module}.{name}", side_effect=replacement)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_connection_changes_require_real_admin_key(self):
        for supplied in (None, "", "CDO", "administrator-test-kex"):
            with self.subTest(supplied=supplied):
                with self.assertRaisesRegex(team_portal.PortalError, "authorization"):
                    pc.require_admin(supplied)
        pc.require_admin("administrator-test-key")
        with patch.dict(os.environ, {"PORTAL_ADMIN_KEY": ""}):
            with self.assertRaisesRegex(team_portal.PortalError, "not configured"):
                pc.require_admin("administrator-test-key")

    def test_choices_and_preview_derive_from_dbt_metadata(self):
        choices = pc.project_choices()
        self.assertEqual(choices[0]["name"], "Equity dbt")
        self.assertTrue(choices[0]["repositoryConnected"])
        self.assertFalse(choices[1]["repositoryConnected"])
        preview = pc.project_preview(17)
        self.assertEqual(preview["repository"], "robin-bajaj/federated-semantic-poc")
        self.assertEqual(preview["defaultBranch"], "main")
        self.assertEqual(preview["environments"], [
            {"id": 101, "name": "Development", "type": "development", "deploymentType": ""},
        ])
        self.assertNotIn("super-secret", repr(preview))
        self.assertNotIn("password", repr(preview))

    def test_save_team_assignment_and_discover_source_without_credentials(self):
        mapping = pc.assign("team-a", 17, 101)
        self.assertEqual(mapping["environmentName"], "Development")
        self.assertEqual(mapping["projectId"], 17)
        self.assertEqual(mapping["repository"], "robin-bajaj/federated-semantic-poc")
        self.assertEqual(pc.connection_for("team-a")["projectId"], 17)
        self.assertIsNone(pc.connection_for("team-c"))
        catalog = pc.inventory("team-a")
        self.assertEqual(catalog["revision"], SHA)
        self.assertEqual(catalog["sources"], ["stg_team_a_positions"])
        self.assertEqual(catalog["sourceFiles"], [{"name": "stg_team_a_positions", "path": STAGE_A}])
        self.assertEqual(len(catalog["models"]), 1)
        model = catalog["models"][0]
        self.assertEqual(model["semanticName"], "team_a_equity_positions")
        self.assertEqual(model["contract"], {"name": "cdo.position", "version": 1})
        self.assertNotIn("super-secret", repr(catalog))

    def test_read_only_sql_and_yaml_are_pinned_to_revision_and_team(self):
        pc.assign("team-a", 17, 101)
        sql = pc.model_file("team-a", STAGE_A)
        self.assertEqual(sql["content"], SQL)
        self.assertEqual(sql["revision"], SHA)
        self.assertEqual(pc.model_file("team-a", FILE_A)["content"], YAML)
        for bad in (FILE_C, "secrets/passwords.txt", "../models/staging/team_a/stg_team_a_positions.sql"):
            with self.subTest(bad=bad):
                with self.assertRaises(team_portal.PortalError):
                    pc.model_file("team-a", bad)

    def test_reject_other_projects_environment_or_bad_role(self):
        with self.assertRaisesRegex(team_portal.PortalError, "environment"):
            pc.assign("team-a", 17, 102)
        with self.assertRaises(team_portal.PortalError):
            pc.assign("cdo", 17, 101)
        self.assertIsNone(pc.connection_for("team-a"))

    def test_dbtlayer_is_not_a_source_of_user_secrets(self):
        pc.assign("team-c", 17, 101)
        self.assertEqual(pc.inventory("team-c")["models"], [{"file": FILE_C, "invalid": True}])
        response = repr(pc.all_connections())
        self.assertNotIn("super-secret-github", response)
        self.assertNotIn("super-secret-dbt", response)

    def test_unrelated_git_provider_and_bad_subdirectory_are_refused(self):
        self.assertEqual(pc._repo_name({"remote_url":
                         "git@github.com:robin-bajaj/federated-semantic-poc.git"}),
                         "robin-bajaj/federated-semantic-poc")
        with self.assertRaises(team_portal.PortalError):
            pc._repo_name({"remote_url": "https://gitlab.com/example/dbt.git"})
        with self.assertRaises(team_portal.PortalError):
            pc._subdirectory({"dbt_project_subdirectory": "../other"})


if __name__ == "__main__":
    unittest.main()

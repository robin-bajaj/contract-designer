"""Central CI tests: team neutral, exact SHA, fail closed, no live network."""
import hashlib
import hmac
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server import central_ci, central_ci_queue, github_app_ci, central_ci_worker
from server.validation_runtime import StepFailure

SHA = "a" * 40
EVENT = {"repository": "example/models", "pr": 42, "sha": SHA,
         "role": "team-risk", "installation": 73}
CONNECTION = {"repository": "example/models", "branch": "main", "subdirectory": ""}


class CentralValidationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        env = patch.dict(os.environ, {"PORTAL_DB_PATH": str(Path(temp.name) / "portal.sqlite3")})
        env.start()
        self.addCleanup(env.stop)

    def test_missing_warehouse_credentials_fail_closed(self):
        with self.assertRaisesRegex(StepFailure, "Missing platform-managed"):
            central_ci.ci_environment("team-risk", {})

    def test_validates_exact_pr_and_requires_build(self):
        calls = []
        def snapshot(role, project, *, commit_sha):
            self.assertEqual((role, commit_sha), ("team-risk", SHA))
            project.mkdir(parents=True)
            (project / "dbt_project.yml").write_text("name: warehouse_project\n")
            return {"revision": commit_sha}
        def runner(step, argv, cwd, env=None, timeout=90):
            calls.append(step)
            if step == "Load CDO governance":
                (Path(argv[-1]) / "src").mkdir(parents=True)
                (Path(argv[-1]) / "contracts").mkdir()
            if step == "dbt parse":
                (Path(cwd) / "target").mkdir()
                (Path(cwd) / "target/manifest.json").write_text("{}")
            return "passed"
        env = {"DBT_PG_HOST": "localhost", "DBT_PG_USER": "ci", "DBT_PG_PASSWORD": "ci",
               "DBT_PG_DBNAME": "ci", "DBT_PG_PORT": "5432"}
        with patch("server.central_ci.project_connections.connection_for", return_value=CONNECTION), \
             patch("server.central_ci.shutil.which", side_effect=lambda cmd: "/usr/bin/" + cmd):
            result = central_ci.validate_pr("team-risk", "example/models", SHA,
                      runner=runner, snapshot=snapshot, credentials=lambda role: env)
        self.assertTrue(result["ok"], result)
        self.assertEqual(calls[-2:], ["dbt parse", "dbt build"])
        self.assertIn("Validate contract registry", calls)

    def test_failed_dbt_build_is_not_passed(self):
        def snapshot(role, project, *, commit_sha):
            project.mkdir(parents=True)
            (project / "dbt_project.yml").write_text("name: test\n")
            return {"revision": commit_sha}
        def runner(step, argv, cwd, env=None, timeout=90):
            if step == "dbt parse":
                (Path(cwd) / "target").mkdir()
                (Path(cwd) / "target/manifest.json").write_text("{}")
            if step == "dbt build":
                raise StepFailure(step, "Database relation does not exist")
            return "ok"
        env = {x: "dummy" for x in ("DBT_PG_HOST", "DBT_PG_USER", "DBT_PG_PASSWORD",
                                    "DBT_PG_DBNAME")}
        with patch("server.central_ci.project_connections.connection_for", return_value=CONNECTION), \
             patch("server.central_ci.shutil.which", return_value="/usr/local/bin/dbt"), \
             patch.dict(os.environ, {"CDO_GOVERNANCE_PATH": ""}):
            result = central_ci.validate_pr("team-risk", "example/models", SHA,
                    runner=runner, snapshot=snapshot, credentials=lambda role: env)
        self.assertFalse(result["ok"])
        self.assertIn("dbt build", result["error"])

    def test_signed_webhook_verification(self):
        body = b'{"action":"opened"}'
        signature = "sha256=" + hmac.new(b"secret", body, hashlib.sha256).hexdigest()
        self.assertTrue(github_app_ci.verify_webhook(body, signature, "secret"))
        self.assertFalse(github_app_ci.verify_webhook(body + b" ", signature, "secret"))
        self.assertFalse(github_app_ci.verify_webhook(body, None, "secret"))
        self.assertFalse(github_app_ci.verify_webhook(body, signature, ""))

    def test_event_resolves_team_from_connected_repo(self):
        payload = {
            "action": "opened", "repository": {"full_name": "example/models"},
            "installation": {"id": 73},
            "pull_request": {"number": 42,
                "head": {"sha": SHA, "ref": "portal/team_risk/new-semantic", "repo": {"full_name": "example/models"}},
                "base": {"ref": "main"}}
        }
        with patch("server.github_app_ci.central_ci.candidate_role", return_value="team-risk"), \
             patch("server.github_app_ci.central_ci.project_connections.connection_for", return_value=CONNECTION):
            result = github_app_ci.parse_event("pull_request", payload)
        self.assertEqual(result, EVENT)
        payload["pull_request"]["head"]["repo"]["full_name"] = "fork/models"
        with patch("server.github_app_ci.central_ci.candidate_role", return_value="team-risk"):
            self.assertIsNone(github_app_ci.parse_event("pull_request", payload))

    def test_durable_queue_deduplicates_webhook_delivery(self):
        a = central_ci_queue.enqueue(EVENT)
        self.assertEqual(a, central_ci_queue.enqueue(EVENT))
        claimed = central_ci_queue.claim_one()
        self.assertEqual(claimed["id"], a)
        self.assertIsNone(central_ci_queue.claim_one())
        central_ci_queue.finish(a, {"ok": True, "summary": "passed"})
        self.assertEqual(central_ci_queue.status("team-risk", 42)[0]["status"], "passed")

    def test_separate_worker_reports_failure_state(self):
        central_ci_queue.enqueue(EVENT)
        self.assertTrue(central_ci_worker.process_one(
            execute=lambda event: {"ok": False, "error": "dbt contract mismatch"}))
        self.assertEqual(central_ci_queue.status("team-risk", 42)[0]["status"], "failed")


if __name__ == "__main__":
    unittest.main()

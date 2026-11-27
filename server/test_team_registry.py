"""Any registered team gets a workspace without adding code branches."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server import team_registry, team_portal


class TeamRegistryTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        patcher = patch.dict("os.environ", {"PORTAL_DB_PATH": str(Path(temp.name) / "portal.sqlite3")})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_default_teams_and_cdo_are_available(self):
        ids = {item["id"] for item in team_registry.list_roles()}
        self.assertEqual(ids, {"cdo", "team-a", "team-c"})

    def test_nth_team_can_register_and_resume(self):
        team = team_registry.register({"role": "team-risk", "label": "Risk Analytics"})
        self.assertEqual(team["id"], "team-risk")
        roles = team_registry.list_roles()
        self.assertIn(team, roles)
        self.assertIn(team, team_registry.list_roles())
        with self.assertRaisesRegex(team_portal.PortalError, "already registered"):
            team_registry.register({"role": "team-risk", "label": "Duplicate"})

    def test_rejects_unsafe_identifier(self):
        for value in ("../../cdo", "cdo", "team-a/../../", "team-"):
            with self.subTest(value=value), self.assertRaises(team_portal.PortalError):
                team_registry.register({"role": value, "label": "Bad"})


if __name__ == "__main__":
    unittest.main()

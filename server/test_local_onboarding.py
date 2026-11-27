"""Code-free dbt project onboarding stays restricted to local development."""
import unittest
from server.fast_validate import local_onboarding_request_allowed

class LocalOnboardingTests(unittest.TestCase):
    def test_local_vite_proxy_request_allowed(self):
        self.assertTrue(local_onboarding_request_allowed(
            "127.0.0.1","localhost:5173","http://localhost:5173"))
        self.assertTrue(local_onboarding_request_allowed(
            "127.0.0.1","127.0.0.1:8765","http://localhost:5173"))

    def test_reject_remote_client_even_with_local_host(self):
        self.assertFalse(local_onboarding_request_allowed(
            "192.168.1.5","localhost:5173","http://localhost:5173"))

    def test_reject_foreign_origin_and_rebound_hosts(self):
        for host,origin in [
            ("evil.example:5173","http://localhost:5173"),
            ("localhost:5173","http://evil.example"),
            ("localhost:5173","null"),
            ("127.0.0.1:5173","https://localhost:5173"),
            ("localhost:80","http://localhost:5173"),
        ]:
            with self.subTest(host=host,origin=origin):
                self.assertFalse(local_onboarding_request_allowed("127.0.0.1",host,origin))

if __name__=="__main__":
    unittest.main()

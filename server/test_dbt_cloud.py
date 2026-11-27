"""dbt Cloud Administrative API is server-side and restricted to known endpoints."""
import io
import json
import unittest
from unittest.mock import patch
from server import dbt_cloud

class Response(io.BytesIO):
    def __enter__(self):
        return self
    def __exit__(self,exc_type,exc,tb):
        self.close()

class CloudTests(unittest.TestCase):
    def setUp(self):
        p=patch.dict("os.environ",{
            "DBT_CLOUD_TOKEN":"secret-value", "DBT_CLOUD_ACCOUNT_ID":"12345",
            "DBT_CLOUD_JOB_ID":"7788", "DBT_CLOUD_HOST":"cloud.getdbt.com",
        })
        p.start()
        self.addCleanup(p.stop)

    def test_lists_jobs_and_keeps_token_out_of_response(self):
        seen=[]
        def opener(request,timeout):
            seen.append(request)
            return Response(json.dumps({"data":[{"id":7788}]}).encode())
        with patch("server.dbt_cloud.urlopen",side_effect=opener):
            result=dbt_cloud.jobs()
        self.assertEqual(result["data"][0]["id"],7788)
        self.assertIn("/api/v2/accounts/12345/jobs/",seen[0].full_url)
        self.assertNotIn("secret-value",seen[0].full_url)
        self.assertEqual(seen[0].get_header("Authorization"),"Token secret-value")

    def test_triggers_only_configured_job(self):
        def opener(request,timeout):
            self.assertEqual(request.get_method(),"POST")
            self.assertIn("/jobs/7788/run/",request.full_url)
            data=json.loads(request.data)
            self.assertIn("existing remote project",data["cause"])
            return Response(b'{"data":{"id":300}}')
        with patch("server.dbt_cloud.urlopen",side_effect=opener):
            self.assertEqual(dbt_cloud.trigger_configured_job()["data"]["id"],300)

    def test_bad_run_identifiers_rejected(self):
        with self.assertRaises(dbt_cloud.DbtCloudError):
            dbt_cloud.run_status("../../secrets")

    def test_missing_token_blocks_requests(self):
        with patch.dict("os.environ",{"DBT_CLOUD_TOKEN":""}):
            with self.assertRaises(dbt_cloud.DbtCloudError):
                dbt_cloud.jobs()


    def test_team_lead_api_call_is_host_allowlisted_and_never_returns_token(self):
        cred={"host":"acme.us1.dbt.com","accountId":123,"token":"lead-token-not-for-browser"}
        calls=[]
        def opener(request,timeout):
            calls.append(request)
            return Response(b'{"data":[{"id":19,"name":"Team A"}]}')
        result=dbt_cloud.connection_request(
            cred,"/api/v2/accounts/123/projects/",opener=opener)
        self.assertEqual(result["data"][0]["id"],19)
        self.assertEqual(calls[0].get_header("Authorization"),"Token lead-token-not-for-browser")
        self.assertNotIn("lead-token",calls[0].full_url)
        self.assertNotIn("lead-token",repr(result))
        for host in ("localhost","127.0.0.1","evil.com","https://cloud.getdbt.com"):
            with self.subTest(host=host),self.assertRaises(dbt_cloud.DbtCloudError):
                dbt_cloud.validate_host(host)

    def test_team_lead_api_refuses_redirects(self):
        from urllib.error import HTTPError
        cred={"host":"cloud.getdbt.com","accountId":123,"token":"lead-token"}
        def redirect(request,timeout):
            raise HTTPError(request.full_url,302,"redirect",{},None)
        with self.assertRaisesRegex(dbt_cloud.DbtCloudError,"redirect"):
            dbt_cloud.connection_request(cred,"/api/v2/accounts/123/projects/",opener=redirect)

if __name__=="__main__":
    unittest.main()

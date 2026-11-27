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

if __name__=="__main__":
    unittest.main()

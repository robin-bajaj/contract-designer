"""Small server-side dbt Administrative API client.

Only allowlisted operations are exposed. Secrets never reach the React client.
The Admin API runs jobs from a remote dbt platform project; it does not upload
unsaved local files. Never describe a remote run as deploying a portal draft.
"""
from __future__ import annotations
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class DbtCloudError(RuntimeError):
    pass


def configured() -> bool:
    return bool(os.environ.get("DBT_CLOUD_TOKEN")
                and os.environ.get("DBT_CLOUD_ACCOUNT_ID"))


def account() -> str:
    number = os.environ.get("DBT_CLOUD_ACCOUNT_ID", "")
    if not number.isdigit():
        raise DbtCloudError("DBT_CLOUD_ACCOUNT_ID must be configured as a numeric account ID")
    return number


def request(method: str, resource: str, payload=None, *, opener=None) -> dict:
    opener = opener or urlopen
    token = os.environ.get("DBT_CLOUD_TOKEN")
    if not token:
        raise DbtCloudError("DBT_CLOUD_TOKEN is not configured")
    host = os.environ.get("DBT_CLOUD_HOST", "cloud.getdbt.com").strip()
    if "://" in host or "/" in host or not host:
        raise DbtCloudError("DBT_CLOUD_HOST must be a hostname, not a URL")
    if not resource.startswith("/api/v2/accounts/"):
        raise DbtCloudError("Only allowlisted dbt Administrative API endpoints can be used")
    url = f"https://{host}{resource}"
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = Request(url, data=body, method=method, headers={
        "Authorization": f"Token {token}", "Accept": "application/json",
        **({"Content-Type": "application/json"} if body is not None else {}),
    })
    try:
        with opener(req, timeout=20) as response:
            data = json.load(response)
    except HTTPError as exc:
        raise DbtCloudError(f"dbt Cloud returned HTTP {exc.code}") from exc
    except (URLError, TimeoutError) as exc:
        raise DbtCloudError("Cannot connect to dbt Cloud API") from exc
    if not isinstance(data, dict):
        raise DbtCloudError("Unexpected dbt Cloud API response")
    return data


def jobs() -> dict:
    return request("GET", f"/api/v2/accounts/{account()}/jobs/")


def run_status(run_id: str) -> dict:
    if not str(run_id).isdigit():
        raise DbtCloudError("Run ID must be numeric")
    return request("GET", f"/api/v2/accounts/{account()}/runs/{run_id}/")


def trigger_configured_job() -> dict:
    job = os.environ.get("DBT_CLOUD_JOB_ID", "")
    if not job.isdigit():
        raise DbtCloudError("Set DBT_CLOUD_JOB_ID to an existing authorized dbt job")
    return request("POST", f"/api/v2/accounts/{account()}/jobs/{job}/run/",
                   {"cause": "Triggered manually from Semantic Governance Portal (existing remote project revision)"})

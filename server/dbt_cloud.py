"""Small server-side dbt Administrative API client.

Only allowlisted operations are exposed. Secrets never reach the React client.
The Admin API runs jobs from a remote dbt platform project; it does not upload
unsaved local files. Never describe a remote run as deploying a portal draft.
"""
from __future__ import annotations
import json
import os
import re
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

# Read-only dbt Administrative API calls for the project connection wizard.
# The dbt account (and all secrets) are configured by a platform operator.
def projects() -> dict:
    return request("GET", f"/api/v2/accounts/{account()}/projects/")


def project(project_id: int) -> dict:
    if type(project_id) is not int or project_id < 1:
        raise DbtCloudError("Invalid dbt project identifier")
    return request("GET", f"/api/v2/accounts/{account()}/projects/{project_id}/")


def environments(project_id: int) -> dict:
    if type(project_id) is not int or project_id < 1:
        raise DbtCloudError("Invalid dbt project identifier")
    return request("GET", f"/api/v2/accounts/{account()}/environments/?project_id={project_id}")


def repository(repository_id: int) -> dict:
    if type(repository_id) is not int or repository_id < 1:
        raise DbtCloudError("Invalid dbt repository identifier")
    return request("GET", f"/api/v2/accounts/{account()}/repositories/{repository_id}/")

# Team Lead onboarding uses credentials supplied through the portal on a
# server-bound HTTPS request. No dbt token appears in a query string or in a
# response. Allow only known dbt API hosts to avoid server-side request forgery.
CELL_HOST = re.compile(r"^[a-z0-9-]+\\.(?:us[123]|eu[1234]|au[12]|jp1)\\.dbt\\.com$")
LEGACY_HOSTS = {"cloud.getdbt.com", "emea.dbt.com", "au.dbt.com"}


def validate_host(host: str) -> str:
    if not isinstance(host, str) or len(host) > 180:
        raise DbtCloudError("Invalid dbt account API host")
    value = host.lower().strip()
    extra = {x.strip().lower() for x in os.environ.get("PORTAL_DBT_ALLOWED_HOSTS", "").split(",") if x.strip()}
    if value in LEGACY_HOSTS or CELL_HOST.fullmatch(value) or value in extra:
        if re.fullmatch(r"[a-z0-9][a-z0-9.-]*[a-z0-9]", value):
            return value
    raise DbtCloudError("Use your account's dbt API hostname shown in Account settings")


def connection_request(credentials: dict, resource: str, *, opener=None) -> dict:
    """Authenticated read-only request for a Team Lead-supplied dbt account."""
    host = validate_host(credentials.get("host"))
    account_id = credentials.get("accountId")
    token = credentials.get("token")
    if type(account_id) is not int or account_id <= 0 or not isinstance(token, str) or not token.strip():
        raise DbtCloudError("Provide an account ID and service token")
    prefix = f"/api/v2/accounts/{account_id}/"
    if not resource.startswith(prefix) or any(c in resource for c in ("#", "\\", "\r", "\n")):
        raise DbtCloudError("dbt endpoint is not authorized for this account")
    if len(resource) > 300:
        raise DbtCloudError("Invalid dbt endpoint")
    req = Request(f"https://{host}{resource}", headers={
        "Authorization": f"Token {token}", "Accept": "application/json",
    })
    try:
        with (opener or urlopen)(req, timeout=20) as response:
            data = json.load(response)
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise DbtCloudError("dbt rejected the service token or its permissions") from exc
        raise DbtCloudError(f"dbt returned HTTP {exc.code}") from exc
    except (URLError, TimeoutError) as exc:
        raise DbtCloudError("Cannot connect to the selected dbt account") from exc
    if not isinstance(data, dict):
        raise DbtCloudError("Unexpected dbt API response")
    return data


def connected_projects(credentials: dict) -> dict:
    return connection_request(credentials, f"/api/v2/accounts/{credentials['accountId']}/projects/")


def connected_project(credentials: dict, project_id: int) -> dict:
    if type(project_id) is not int or project_id < 1:
        raise DbtCloudError("Invalid dbt project ID")
    return connection_request(credentials, f"/api/v2/accounts/{credentials['accountId']}/projects/{project_id}/")


def connected_environments(credentials: dict, project_id: int) -> dict:
    if type(project_id) is not int or project_id < 1:
        raise DbtCloudError("Invalid dbt project ID")
    return connection_request(credentials, f"/api/v2/accounts/{credentials['accountId']}/environments/?project_id={project_id}")


def connected_repository(credentials: dict, repository_id: int) -> dict:
    if type(repository_id) is not int or repository_id < 1:
        raise DbtCloudError("Invalid dbt repository ID")
    return connection_request(credentials, f"/api/v2/accounts/{credentials['accountId']}/repositories/{repository_id}/")

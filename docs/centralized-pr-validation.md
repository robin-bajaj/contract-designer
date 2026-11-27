# Centralized PR validation — CDO platform owned

## Goal
All teams own their dbt projects and authored SQL/YAML. No team maintains
`.github/workflows/cdo-semantic-ci.yml`. A centrally installed GitHub App
routes PRs to one CDO-owned validation service. This implementation is an
**opt-in migration milestone**, not yet an activated deployment.

## Components
- `server/fast_validate.py` POST `/api/github/webhook`: accepts signed GitHub
  `pull_request` events; returns 403 on invalid HMAC; enqueues rather than
  executing dbt on the API server
- `server/central_ci_queue.py`: durable SQLite queue / status; deduplicates
  repeated deliveries per repo/PR/commit
- `server/central_ci_worker.py`: separate process, `--once` or `--loop`;
  production deployment **must sandbox each PR in isolated worker containers**
- `server/github_app_ci.py`: GitHub App installation tokens and GitHub Check
  Runs named `CDO Central Semantic Validation`
- `server/central_ci.py`: downloads an exact PR Git commit from the team's
  connected repo; compiles central contracts; runs `dbt parse`, `dbt build`
  against a restricted Postgres validation database; no per-team workflow YAML

## What happens
1. Team Lead connects a dbt project and the GitHub repo in portal. CDO
   operator separately installs the central GitHub App on that repository.
2. Developer creates a model via portal and opens a PR from branch
   `portal/<team_id>/...` targeting the connected base branch.
3. GitHub sends an HMAC-authenticated `pull_request` event to the central
   webhook (opened / synchronized / reopened / ready_for_review).
4. The webhook validates identity and queues the exact head SHA.
5. A separate isolated worker checks the latest PR SHA, authenticates via the
   App's scoped installation token, and publishes a GitHub Check Run.
6. The validator loads the entire GitHub project at the exact SHA, loads the
   approved CDO contracts, runs inheritance compilation in a *temporary*
   project, then executes `dbt parse` followed by `dbt build` in a fresh
   schema `ci_<team>_<sha>`.
7. GitHub check succeeds only after a full database-backed build succeeds.
   Missing warehouse credentials, compilation errors, parse failures and build
   failures all fail closed. A retried/replaced commit has a new SHA and check.
8. Keep existing team CI until this check is installed and required on the
   target repository's branch protection/ruleset. Never remove both gates
   simultaneously.

## Required operator setup (not performed automatically)
A. Register a GitHub App with **Checks: Read/write**, **Contents: Read-only**,
   **Pull requests: Read-only**, and subscribe to Pull request webhooks.
   Install the App on team repositories. Define a shared webhook secret.
B. Configure the App's webhook URL to a TLS-protected public HTTPS ingress for
   `/api/github/webhook` with reverse-proxy and rate limits. A default local
   `127.0.0.1` development server is **not** a publicly reachable webhook.
C. Configure secret values `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
   `GITHUB_APP_WEBHOOK_SECRET` securely on the platform. Do not commit them.
D. Provide **platform-managed scoped warehouse credentials** to each isolated
   worker. For `team-risk` the present PostgreSQL adapter uses
   `CENTRAL_CI_TEAM_RISK_PG_HOST`, `_USER`, `_PASSWORD`, `_DBNAME`,
   optional `_PORT`. Keep credentials in central secret storage; NEVER in
   team repos. This POC currently uses direct validation credentials, not
   the team's existing dbt Cloud warehouse connection; an executor backed by
   the team's dbt Cloud environment is a future integration.
E. Deploy API and worker with appropriate access to the durable queue
   database. Run the worker inside a tightly sandboxed environment; the worker
   runs repository-supplied dbt/Jinja code and must not have production write
   permissions or unrestricted access to platform secrets. Isolate runs and
   clean up CI schemas. This POC's SQLite job queue is not a scalable production
   task broker; move to a managed queue before production.
F. Use an organization/repository GitHub ruleset to require the check named
   `CDO Central Semantic Validation` from the trusted GitHub App, together
   with PR reviews. Setting a required check and deploying the App are
   independent operator steps. Without branch protection, a failed check
   **does not automatically prevent merges**.
G. Test one actual PR end to end including an intentionally invalid dbt
   contract, a passing build, and a PR synchronize event. Only then retire
   the existing `federated-semantic-poc` CI workflow.

## Local worker command
```bash
python -m server.central_ci_worker --once
# or run in a separate persistent isolated worker container:
python -m server.central_ci_worker --loop
```

## Initial scope / limitations
- Current event routing accepts PRs **from the same repository** on
  `portal/<team>/...` branches. Fork PRs and arbitrary branches are not run.
- Executor supports PostgreSQL validation warehouses with platform-supplied
  credentials. It does not dynamically leverage dbt Cloud project credentials.
- All models in the linked project are validated with `dbt build`. Large
  projects need a state-aware selection strategy and schema cleanup policies.
- Existing PR checks in `federated-semantic-poc` remain fully untouched.
- New PR statuses can be read through local
  `/api/central-ci/status?role=team-risk&pr=42`. This endpoint is for the
  localhost demo and requires server-side authorization before exposing
  user-specific results on any public deployment.
- Required check name must be configured on the actual target GitHub branch
  before it can enforce anything.

# Model publication to the linked GitHub repository

Team Leads connect a fine-grained GitHub token in **Manage connections** after linking a dbt Cloud project. The portal verifies the exact repository using the existing project connection; no repository name is supplied by model editors.

Token repository permissions:
- **Contents: Read and write** (create feature branches and commit SQL/YAML)
- **Pull requests: Read and write** (open proposed changes)
- **Metadata: Read-only** (implicit)

## Flow

1. Save SQL and semantic YAML as a portal draft.
2. Validate via the existing CDO compiler and dbt Core parse checks.
3. Click **Create GitHub PR**. The backend checks the recorded validation digest to prevent stale submissions.
4. Retrieve the linked repository's current default branch commit and full file tree. For new source models, reject any SQL or YAML file already present. For existing sources, require their staging SQL to exist remotely.
5. Create a single Git tree/commit with the team's new files on an isolated `portal/team_a/...` or `portal/team_c/...` feature branch.
6. Open a PR targeting the dbt-linked repository's default branch and display the PR URL. The portal saves the PR number and marks the draft `submitted`.

The portal does **not** merge into `main`, bypass branch protections, trigger a deployment, overwrite existing repository files, or update the local managed project on publication. GitHub reviewers and required CI checks control merging; downstream dbt Cloud jobs consume approved merges according to their configured schedules/triggers.

Existing source-file edits remain unsupported in this milestone. If a remote staging SQL path already exists, create a semantic YAML that references it using **existing source mode**.

If GitHub successfully creates the feature branch but PR creation fails, the branch may remain on GitHub. Inspect it before retrying with another draft. Full retry/recovery and centralized identity authorization are future production hardening.

**Security**: The POC is bound to localhost and the team selector does not authenticate users. Deploying to multiple users requires SSO, backend-enforced per-team roles, managed secrets, audit logs, token rotation, request CSRF protection, and a policy restricting write actions to authorized reviewers.

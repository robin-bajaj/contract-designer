# Team Lead GitHub connection (local POC)

The Team Lead can connect the repository already linked through dbt Cloud using a **fine-grained GitHub personal access token**. A GitHub App is not necessary for this POC.

## Setup

1. Open https://github.com/settings/personal-access-tokens/new.
2. Select the GitHub resource owner that owns the linked dbt repository (for example `robin-bajaj`).
3. Restrict **Repository access → Only select repositories** to `federated-semantic-poc`.
4. Grant **Repository permissions → Contents: Read-only** (Metadata: Read-only is included).
5. Prefer a short expiration and follow organizational token-approval requirements.
6. In the local portal, open **Team A → Manage connections → GitHub repository access**, paste the token, and select **Connect GitHub**.

The backend verifies the token against the linked repository and its Git tree before persisting it. It encrypts the token in the local SQLite database using the existing Fernet key file with 0600 permissions. The token is cleared from the browser form on success; it is never committed to Git or returned through an HTTP response. **Disconnect GitHub** clears the stored credential. No `PORTAL_GITHUB_READ_TOKEN` environment variable is required.

This connection enables read-only project explorer access, not Git commits, PR creation, or merge. The model publisher still writes only to a portal-managed local project.

## Security limitations

**This prototype is localhost-only, not production-ready.** The team role selector is not identity verification and any user with access to the local backend can access the role's repository files. Before deploying to multiple users, add SSO, backend-enforced RBAC, per-team credential authorization, CSRF protection, audit logging, managed secrets with envelope encryption, expiry/rotation handling and a separate workflow for pull request publishing. A GitHub App with short-lived credentials is preferable for a multi-user production deployment.

Do not commit tokens, place them in frontend environment files, or paste them into issue trackers.

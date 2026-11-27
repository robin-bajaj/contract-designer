# Team Lead GitHub App connection (local POC)

The portal uses **one GitHub App** owned by the organization, not one personal access token per Team Lead.

## Platform setup (one-time)

1. Register a GitHub App at GitHub Developer Settings. Select the desired repositories during installation.
2. Grant **Repository permissions → Contents: Read-only** and **Metadata: Read-only**. No write or pull-request permission is requested in this milestone.
3. Generate a private key. Keep it **outside the repository**, in a secrets manager in production. Local development may use a secure PEM file with `chmod 600`.
4. Configure the backend process with `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, and `GITHUB_APP_PRIVATE_KEY_PATH`. These refer to the registered app and the secure file path, **not** a user's personal token. Example placeholders (do not commit real values):

   ```sh
   export GITHUB_APP_ID="APP_ID"
   export GITHUB_APP_SLUG="your-org-semantic-portal"
   export GITHUB_APP_PRIVATE_KEY_PATH="/secure/location/github-app.pem"
   npm run dev:api
   ```

Production should inject these values via its deployment/secret management system, not a checked-in `.env`.

## Team Lead workflow

1. Go to **Team workspace → Manage connections** and connect an existing dbt Cloud project.
2. Under **GitHub repository access**, choose **Install / authorize GitHub App**. GitHub handles repository authorization in a separate tab.
3. Return to the portal and click **Verify GitHub connection**. The backend checks the installation for the **exact repository** already verified through dbt Cloud, then persists only the installation ID.
4. The project explorer now reads source using short-lived GitHub installation tokens obtained server-side. The UI receives no private key or installation access token.

**Constraints:** This is a loopback-only POC. The role picker is *not authentication*, and selecting Team A or Team C does not prove Team Lead identity. Production must add SSO, role authorization on every endpoint, and an auditable administrator-approved installation policy. GitHub App permissions are repo-level, not team-folder-level. Read-only repository browsing is enabled; commit, PR creation, approval, merge, and remote model publishing are **not implemented** in this PR.

For support, a missing app setup displays an actionable message. No GitHub App key is committed. `PORTAL_GITHUB_READ_TOKEN` remains a legacy development fallback only.

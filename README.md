# Contract Designer

Visual editor for versioned logical CDO contracts. The authoritative catalog is `robin-bajaj/cdo-semantic-governance/contracts/` on `main`; unpublished edits never enter the catalog before review and merge.

## Getting started

Requires Node.js 22.

```bash
npm ci
npm run check
npm run dev
```

Open the address shown by Vite (usually http://localhost:5173).

## Repository structure

```text
src/
  main.jsx                         # React mount only
  App.jsx                          # Application composition and workspace state
  styles.css                       # Existing app styles
  domain/
    contracts/
      contracts.js                 # Logical contract serialization + validation
      contractTree.js              # Version-aware parent/child model
      dbtOptions.js                # PostgreSQL/dbt editor constraints
      *.test.js                    # Domain regression tests
      contractFixtures.test-data.js
  features/
    canvas/
      ContractCanvas.jsx           # Pan/zoom/drag and context actions
      canvasActions.js
      lineage.js                   # Version-aware graph layout
      *.test.js
    explorer/
      ContractExplorer.jsx         # Contract tree sidebar
    editor/
      PublishPanel.jsx             # PR publishing UI
  services/
    github/
      githubRegistry.js            # Approved registry reads
      githubPublish.js             # New-version PR creation
      *.test.js
    storage/
      registryCache.js             # Last successful GitHub snapshot only
```

React UI files use PascalCase; services, domain functions and hooks use camelCase; tests are colocated. Feature modules must not bypass the domain model or write approved catalog records directly.

## Source-of-truth and versioning

- Only YAML files already merged to the governance repository's `main` appear in the sidebar and canvas.
- Parent inheritance uses **both** `uses.name` and `uses.version`, never a name-only match.
- The previously fetched approved registry snapshot is cached as a read-only fallback if GitHub is unavailable. No sample or local draft is merged into the catalog.
- A new/edited contract is an ephemeral editor draft. Use **Export YAML** for backup; **Save to GitHub (PR)** proposes a versioned file such as `contracts/cdo_position_v2.yml`.
- Existing published versions cannot be overwritten by the publishing workflow. Governance CI and CDO reviewers remain authoritative; the UI only performs preliminary checks.
- `Sync from GitHub` reloads approved contracts. PRs still in review are not shown.

## Security and production deployment

**This is an architecture refactor, not a production security certification.** Today the prototype accepts a GitHub fine-grained token in page memory to create PRs using browser-side REST calls. Do not deploy this approach to a multi-user production environment. Before production, replace it with server-side GitHub App authorization / short-lived credentials, access-control and audit logging, robust conflict/retry handling, and backend validation of submitted YAML. Configure HTTP response limits, provenance verification and observability for registry imports. Add browser end-to-end tests, accessibility audits, and release/deployment controls.

Only contents of a **successful** registry sync are cached. Failed sync must not replace the last approved snapshot. UI positions are stored separately and never become contract YAML.

## Quality gates

```bash
npm test
npm run build
npm run check
```

Pull requests run Node 22 tests and the Vite production build in `.github/workflows/frontend-ci.yml`. Keep CI green before merging. No change to the governance or federated dbt repositories is included in this UI refactor.

## Three-role demo login

The application starts with a role-selection login screen for **CDO**, **Team A**, and **Team C**. This is explicitly a demo UI switcher, **not** identity verification: anyone can select any role without passwords. The CDO option mounts the existing Contract Designer, including its approved GitHub registry view and PR publishing action. Team A and Team C are routed to separate placeholder workspaces with no CDO editor controls. Each workspace has a sign-out action returning to role selection. Selection remains in page memory and resets on refresh.

For enterprise use, replace this with an identity provider (e.g., company SSO through OIDC), backend-verified user sessions, server-enforced RBAC permissions, and server-side GitHub App authorization. Frontend role selection is never a security boundary. No CDO governance YAML or dbt repositories are modified by this UI change.

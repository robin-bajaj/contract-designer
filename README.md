# Contract Designer

Contract Designer displays contracts approved in the GitHub governance registry at `robin-bajaj/cdo-semantic-governance/contracts/` on the `main` branch.

## Run locally

```bash
npm install
npm test
npm run build
npm run dev
```

Open the Vite URL (usually http://localhost:5173).

## GitHub-only catalog

- Only contracts on governance repository `main` appear on the canvas and sidebar.
- The app fetches GitHub's contract-directory listing and reads YAML through `raw.githubusercontent.com` to reduce API rate-limit issues. For GitHub HTTP 403/429 responses, it falls back to jsDelivr directory metadata. For raw content failures, it retries through jsDelivr.
- The last **successfully loaded GitHub snapshot** is cached in browser localStorage only to keep approved contracts visible during an outage; there are no seeded-example or local-draft contracts in the catalog.
- **Sync from GitHub** replaces the catalog with the current approved GitHub registry. It will not show open, unmerged pull requests.
- Contract relationships come from `uses: {name, version}` in YAML. Every version is a separate identity; a child referencing a missing parent version appears as an independent root pending registry correction.

## Editing and publishing

- Right-click a contract, select **View Contract**, and edit or change the version.
- Right-click the empty canvas to draft a new standalone contract, or right-click an existing contract to draft a child.
- Draft work is kept **only in the editor during this page session**; it never appears as an approved contract in the catalog before being merged. Export YAML before refreshing/leaving if you need a local backup.
- The **Save to GitHub (PR)** control creates a proposal in `robin-bajaj/cdo-semantic-governance` using the versioned registry filename (`contracts/cdo_position_v2.yml`). A released version already on `main` cannot be overwritten through this UI.
- After governance CI and human review, merge the PR into governance `main`, then click **Sync from GitHub** to see it in the canvas.
- For GitHub publishing, provide a fine-grained token scoped to the governance repository with Contents Read/Write and Pull Requests Read/Write. The token stays in page memory, not localStorage.
- Structural validation in the browser is preliminary; the governance repository's own validator and CI are authoritative.

## Canvas

Left-drag nodes to reposition; left-drag empty canvas space to pan. Right-click to open the contextual menu. Canvas positions persist separately from contract definitions and never affect exported YAML.

## Security and deployment

The prototype uses direct browser calls and a page-memory fine-grained token. For a multi-user production deployment, implement a GitHub App or short-lived server-issued credentials. Requests can fail due to network conditions, CORS, GitHub rate limits or CDN lag; an error is displayed and the last successful GitHub snapshot remains visible.

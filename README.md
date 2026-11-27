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

## Shared signed-in workspace header

All three demo roles (CDO, Team A and Team C) use a single `src/features/layout/WorkspaceHeader.jsx` instance rendered by `RoleGateway`. Its branding, subtitle, placement, role indicator, and sign-out action are consistent across profiles; only the role label changes. The CDO contract designer and both team pages render content below the shared header and do not own another header.

Role selection is still a UI demonstration rather than server-enforced authentication.

## Team A and Team C semantic model discovery

Team workspaces are **read-only** and automatically load dbt-authored models from the `main` branch of `robin-bajaj/federated-semantic-poc`:
- Team A: `models/semantic_models/team_a/*.yml` and `*.yaml`
- Team C: `models/semantic_models/team_c/*.yml` and `*.yaml`

The GitHub directory listing discovers files (without hardcoding a single YAML filename), then raw GitHub reads load the YAML. Requests use jsDelivr as a fallback for rate limiting/failed raw reads. Only models with an enabled `semantic_model` or an authored `config.meta.uses` declaration are listed. A refresh button reloads current GitHub `main`; no changes are written by Team A/C.

The workspace resolves each model's `config.meta.uses.name` + `version` against the approved `cdo-semantic-governance/contracts/` main-branch registry. It displays:
- CDO-adopted attributes and metrics from `config.meta.include`, together with canonical types, descriptions and metric expressions
- Team-specific aliases, entities, dimensions and granularity
- Team-owned `columns` and `metrics` in separate sections
- dbt model name, semantic model name, group, access, and whether native `contract.enforced` is configured
- Direct source link to the authored YAML in GitHub

**Important:** This is authored YAML metadata, not the output of the CDO compiler and not live dbt Cloud state. The page reports missing contract/version references rather than guessing a match. Validation, compilation and actual database contract enforcement remain in the existing CI/release workflows. The team role selector is UI-only and must not be relied on for access control.

## Create team semantic models from scratch

The **Team A** and **Team C** workspaces now have **Create Semantic Model**. The form can:

1. Author a **new dbt SQL model** in `models/staging/<team>/<name>.sql`, or reference an existing team-owned staging SQL model.
2. Define the semantic model name and description.
3. Optionally select a versioned, approved CDO logical contract and opt into inherited attributes and metrics, with team aliases, entities and dimensions.
4. Add team-owned SQL columns and simple metrics using the current dbt/PostgreSQL editor options.
5. Preview/download native dbt properties YAML and propose it to `models/semantic_models/<team>/<semantic_name>.yml` through a GitHub **pull request**.

If SQL is new, the publishing operation adds **both SQL and YAML** in the same feature branch and PR. Publishing refuses to overwrite existing files. Local structural validation is advisory; the federated dbt project's CDO inheritance compiler, dbt parser, and dbt build checks remain the authoritative quality gates. A new SQL model must have columns consistent with the inherited and team-owned field declarations.

A fine-grained GitHub token with Contents and Pull Requests read/write permissions on `robin-bajaj/federated-semantic-poc` is entered into the browser for PR creation and is not persisted. This remains **prototype-only authoring**, not authenticated, server-side authorization, or live dbt Cloud execution. Before production, replace browser tokens with a GitHub App + server-enforced role permissions and introduce full browser end-to-end tests. Selecting an existing SQL model already described by another semantic YAML may cause dbt configuration conflicts; the team must review these in CI.

Generated models become visible in the Team workspace only after the PR merges to federated `main` and the user refreshes discovery.

## Fast Validate staging with dbt Core (local POC)

**Team A → Create Semantic Model** and **Team C → Create Semantic Model** now include **Validate Staging (dbt Core)**. This validates the exact unsaved staging SQL (for a new SQL model) and unsaved semantic YAML without first creating a GitHub PR or running dbt Studio.

### One-time setup

You need Python 3.12, Git, and network access to the two repositories. From the Contract Designer project folder:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r server/requirements.txt
dbt --version
```

Run the backend and frontend in **separate terminals** (activate the venv in the backend terminal):

```bash
# Terminal 1 — backend on 127.0.0.1:8765
npm run dev:api
```

```bash
# Terminal 2 — frontend on localhost:5173 (Vite proxies /api to the backend)
npm ci
npm run dev
```

Open `http://localhost:5173`, select Team A or Team C, create a semantic model, enter SQL or select an existing team-owned staging SQL model, and choose **Validate Staging (dbt Core)**. The editor shows successful/failed stages and dbt compiler/parser output. Tokens are **not** sent to this backend.

### What happens

The local backend clones fresh disposable checkouts of `robin-bajaj/federated-semantic-poc/main` and `robin-bajaj/cdo-semantic-governance/main` into a temporary directory. It overlays the current unsaved team model SQL and YAML in **the appropriate team folder**, configures a dummy dbt Postgres profile, and runs:

```bash
python -m cdo_governance.semantic.contract_registry --registry ../governance/contracts
python -m cdo_governance.semantic.semantic_compiler --registry ../governance/contracts --project . --bindings-output .ci/cdo-resolved-bindings.yml
dbt parse --profiles-dir .ci --no-partial-parse
```

The temporary directory is deleted after validation. Nothing is committed, published, deployed, or sent to dbt Cloud. SQL is **not executed**, so this cannot establish physical staging types, actual data values, or database model contract enforcement; those still require a dbt build with live Neon credentials. The workspace needs Internet access to clone current `main` on each validation, so this is not an offline service. Existing source mode verifies the source SQL file exists in the team's staging folder.

### Security and production limits

**Development/POC only.** The backend binds loopback (`127.0.0.1:8765`), has a payload limit, validates identifier/path inputs, sets timeouts and limits concurrent checks, and never persists credentials. However, **dbt macros and Jinja can execute Python code**. The temporary checkout alone is **not** a security sandbox. Do not expose this API on a network or accept SQL/YAML from untrusted users. Real production integration requires SSO, role authorization, sandboxed worker containers with restricted network/filesystem access, rate limiting, artifact retention policies, and a controlled GitHub App. This backend does not constitute live dbt Cloud/Studio integration.

The existing federated CI pins a reviewed governance commit. This local preview uses governance `main` for the most recent approved CDO contracts. CI remains authoritative if its pinned compiler differs. Use `npm test` for frontend checks and `npm run test:api` for mock subprocess backend tests.

## Live validation while typing staging SQL

Team A/C → **Create Semantic Model → Create a new SQL model** now validates automatically while typing. Enter a valid staging SQL model name and SQL; after **1.4 seconds without a change**, the app calls `POST /api/validate/staging` through the same-origin Vite proxy.

- **Gray clock:** no SQL yet, or waiting for typing to pause
- **Blue spinner:** current unsaved SQL is being checked
- **Green tick:** the CDO compiler and dbt Core **parse** succeeded for the current SQL draft
- **Red cross:** the backend returned a compilation/parsing failure; expand the details to inspect errors
- **Amber warning:** backend unavailable or too busy; this is **not** an invalid SQL result

Changing SQL or the model name invalidates the old status immediately. In-flight browser requests are aborted, and response signatures prevent stale results from replacing the latest draft. The staging-only endpoint does **not** require semantic model YAML to be finished, nor does it publish a PR or require a GitHub token.

**This is a dbt parsing check, not a SQL execution check.** dbt parse can pass even when SQL syntax would later fail in PostgreSQL, because it does not execute or fully validate physical SQL. A true SQL-executable tick requires a database-connected run/build. Do not treat a green parse tick as proof of physical columns or data types.

The existing **Validate Staging (dbt Core)** button in the full semantic model form remains available for a combined SQL/YAML check. Start the API with `npm run dev:api` and the React app with `npm run dev` as documented above. Automatic validation creates temporary checkouts and can be slow if GitHub is unavailable; it is a local POC, not a shared production service.

## Fix: inline staging validation not starting

The New SQL Model form now fills in an actual editable default source model identifier (for example `team_a_new_positions`), rather than showing that name only as placeholder text. With a nonempty SQL draft, the inline validation runs automatically after typing pauses.

The local validation backend now uses **SQLGlot (PostgreSQL dialect)** for a fast initial syntax check. Gibberish such as `SELECTertygrab` is flagged before the Git clone and dbt Core parsing. Valid SQL continues to CDO compilation and dbt Core parsing. dbt Jinja SQL skips this initial SQLGlot parse because raw Jinja is not directly valid PostgreSQL syntax; dbt Core still parses project metadata.

To enable this new check after merging, reinstall the backend dependencies and restart **both** processes:

```bash
source .venv/bin/activate
python -m pip install -r server/requirements.txt
npm run dev:api
```

In another terminal run `npm run dev`. Validation cannot run if the local Python backend is not running; the UI shows an availability warning in that case. SQLGlot is a preliminary parser and dbt parse does not execute SQL against Neon. Neither establishes physical database schema correctness.

## CDO workspace navigation

The CDO explorer panel has a collapse/expand chevron at the top. When collapsed it reduces to a narrow rail, leaving more space for the contract canvas or editor; click the chevron again to restore the search, contract tree, GitHub sync, and import controls.

On the lineage canvas, **double-clicking a contract** displays the same **View Contract** and **Create Child Contract** options as right-clicking it. Right-clicking blank canvas still offers standalone contract creation, while left-drag continues to move nodes/pan. The left contract explorer supports right-click/double-click action menus too. In the explorer, click the desired menu action to open a contract.

**Escape** closes canvas and explorer context menus and cancels an active canvas pointer interaction. On the contract editor, Escape returns to the canvas (unless a text input is focused, in which case the first Escape blurs that field). The common header and Team A/C views are unchanged.

## Full-height CDO canvas

The CDO contract canvas now expands vertically to use the available browser viewport below the shared header, instead of stopping at a fixed 620px height. The canvas toolbar stays attached to the top of the canvas, and pan/zoom, double-click menus, and sidebar collapse remain supported. For smaller viewports, minimum heights preserve usable canvas space; the page scrolls only when needed. The contract editor and Team A/C screens retain their existing layouts.

## Canvas arrows, zoom, and help text

The CDO lineage canvas connects each child card directly to the bottom-center of the **exact parent contract version** referenced by its `uses` declaration. Each curved connector uses the saved/current card positions instead of a shared horizontal bus, avoiding misleading arrows when roots and children are repositioned.

The canvas now opens at **100% zoom**, centered on the diagram. The **Fit all contracts** toolbar control still automatically computes a suitable scale when clicked. **Reset positions** restores the automatic node layout and centers it at 100%.

Usage instructions appear **once**, in the canvas toolbar. Zoom Out, Zoom In, Fit All, Reset and the current zoom percentage have descriptive native hover tooltips. This change does not modify governance contracts, YAML, or team workspaces.

## Immediate canvas control hints and safe zoom reset

The CDO canvas toolbar shows descriptive tooltips **immediately on hover or keyboard focus**, without requiring a click or waiting for browser-native title popups. Hover/focus itself never pans, zooms, or moves contract cards.

The toolbar now makes two distinct actions explicit:

- **Reset zoom to 100%** (`RotateCcw`): changes only the zoom transform, preserving every saved card position.
- **Restore automatic card positions** (`LayoutGrid`): intentionally clears custom node coordinates and returns the graph to its original auto-layout (at 100% zoom).

**Fit all contracts** intentionally recenters and rescales the viewport when clicked. If you only want to read what a control does, hover it; no click is necessary.

## Screen-anchored CDO lineage and simplified zoom controls

The contract canvas renders connectors in an SVG overlay aligned to the **visible canvas viewport**, using the actual `getBoundingClientRect()` of each parent and child card. This ensures connectors follow their cards when contracts are dragged, the diagram is panned or zoomed, or the browser/sidebar changes size. Parent lookup still respects the exact `uses.name` and `uses.version` contract.

The toolbar is intentionally just **Zoom out (−)**, **zoom percentage**, **Zoom in (+)**, and **Center canvas at 100%**. The center action recenters and resets view scale while preserving all manually moved card coordinates. There is no layout-reset action in the toolbar; saved positions remain intact. Help labels are displayed immediately on hover/focus. 

## Excalidraw-style bound arrows in the CDO canvas

Each inherited contract relationship is now drawn as a **shape-bound straight arrow**, rather than a free-floating curve forced to leave the parent bottom and enter the child top. Endpoints are computed where a center-to-center ray meets each visible card's rectangle, with a small gap for the arrowhead. The attachment sides switch automatically (left/right/top/bottom) when either card is dragged to another side of its peer. For example:

- Parent directly above child → bottom of parent to top of child
- Parent to the left of child → right of parent to left of child
- Parent to the right of child → left of parent to right of child

The binding always uses the exact pinned `uses.name` and `uses.version`, never a similarly named newer contract. Coordinates come from the **actual rendered DOM rectangles** and are refreshed after drag, pan, zoom, viewport/card resize, and contract changes. This makes the relationship readable even if the user manually places contracts in arbitrary positions.

This uses native SVG and our existing React canvas, **not an embedded Excalidraw editor**. Manually arranged positions are preserved and remain stored locally. The existing toolbar remains −, percentage, +, and Center at 100%.

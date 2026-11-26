# Contract Designer

Independent React/Vite frontend prototype for the `cdo-semantic-governance` business contract registry. Visual layout follows the supplied green-and-white contract explorer/editor reference. This project **does not modify** the existing governance or federated dbt repositories.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`).

## Features

- Interactive parent/child lineage canvas with draggable cards, pan, zoom, fit-to-view, reset, and search
- Create standalone or child contracts
- Edit standalone attributes and simple metrics
- Select inherited attributes/metrics from a version-pinned parent
- Import YAML; live YAML preview and per-contract downloads named exactly `<contract.name>.yml`
- Local structural validation and duplicate-name/unknown-reference checks
- Seeded with the **actual** `cdo.all`, `cdo.position`, and `cdo.counterparty` definitions from the governance repo (as of Nov 26, 2026)

## Compatibility and caveats

The project supports the repository's logical contract YAML shapes: `name`, integer `version`, `attributes`, `metrics`, and child `uses/include`. It intentionally avoids treating generic dbt model `contract.enforced` as equivalent to this logical CDO contract format.

Contract definitions and edits live **in browser memory** only: reload resets to the embedded examples. Canvas card positions are saved separately in browser localStorage and can be reset from the canvas toolbar; the layout never modifies contract YAML. Use **Export YAML** to save each edited file. No direct GitHub write, authentication, autosave, repository connection, or backend validation is included. Local validation is only a preflight: the existing Python `contract_registry` validator and federated CI remain authoritative. The UI's standalone metric editor currently supports simple SUM/COUNT metrics over named attributes. For existing sophisticated definitions, avoid overwriting unsupported fields without a round-trip fidelity test.

Import the YAML files from `cdo-semantic-governance/contracts/` to edit. Keep filenames such as `cdo_position_v1.yml`; export filenames are now `cdo.position.yml`, `cdo.all.yml`, etc., matching the logical contract name requested in the UI. **The existing governance registry uses filenames such as `cdo_position_v1.yml`**; rename downloaded files to that registry convention before adding them to the governance repository, then raise PRs for review. Do not commit changes to published contract versions in place unless your governance process permits it; prefer a new version.

## Create the separate GitHub repo

Create an empty repository named `contract-designer` under the GitHub account/organization of your choice, without auto-generating files. In this downloaded project's directory:

```bash
git init
git add .
git commit -m "feat: bootstrap visual contract designer"
git branch -M main
git remote add origin https://github.com/YOUR_OWNER/contract-designer.git
git push -u origin main
```

The frontend has **no runtime dependency on the other two repositories**. A later integration can read contract YAML through a controlled backend/API and create reviewed PRs, while keeping the GitHub YAML registry the source of truth.

## Interactive canvas

Drag contracts to reposition, drag empty canvas space to pan, zoom using the toolbar or scroll wheel, use Fit to center all contracts, or Reset positions to restore the automatic layout. Clicking a card opens the existing editor. Node coordinates are UI preferences only and never become part of exported governance YAML.

## Verification

```bash
npm test
npm run build
```

The layout tests use Node's built-in test runner. The build requires installed npm dependencies.

## Contract tree and YAML preview

The sidebar nests child contracts beneath the exact versioned parent referenced in their `uses` metadata. Expand/collapse using the chevron, and use the + icon beside a parent to create a child of that contract. Searching keeps ancestor nodes visible for context. Missing-parent drafts appear as roots rather than vanishing. Selecting a contract opens its editor with a **live YAML preview** beneath contract details; choose **View YAML** to scroll to it or **Download .yml** to export its exact contract name. Preview and export use the same `toContractDocument` serializer.

These changes do not add automatic contract persistence or GitHub publishing. Changes remain browser-memory drafts until YAML export.

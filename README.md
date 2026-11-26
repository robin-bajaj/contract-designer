# Contract Designer

Independent React/Vite frontend prototype for the `cdo-semantic-governance` business contract registry. Visual layout follows the supplied green-and-white contract explorer/editor reference. This project **does not modify** the existing governance or federated dbt repositories.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`).

## Features

- Contract explorer with parent/child lineage links and search
- Create standalone or child contracts
- Edit standalone attributes and simple metrics
- Select inherited attributes/metrics from a version-pinned parent
- Import YAML; preview or export per-contract YAML
- Local structural validation and duplicate-name/unknown-reference checks
- Seeded with the **actual** `cdo.all`, `cdo.position`, and `cdo.counterparty` definitions from the governance repo (as of Nov 26, 2026)

## Compatibility and caveats

The project supports the repository's logical contract YAML shapes: `name`, integer `version`, `attributes`, `metrics`, and child `uses/include`. It intentionally avoids treating generic dbt model `contract.enforced` as equivalent to this logical CDO contract format.

The contract hierarchy and edits live **in browser memory** only: reload resets to the embedded examples. Use **Export YAML** to save each edited file. No direct GitHub write, authentication, autosave, repository connection, or backend validation is included. Local validation is only a preflight: the existing Python `contract_registry` validator and federated CI remain authoritative. The UI's standalone metric editor currently supports simple SUM/COUNT metrics over named attributes. For existing sophisticated definitions, avoid overwriting unsupported fields without a round-trip fidelity test.

Import the YAML files from `cdo-semantic-governance/contracts/` to edit. Keep filenames such as `cdo_position_v1.yml`; export filenames currently use underscores based on contract names, then raise PRs in the governance repository for review. Do not commit changes to published contract versions in place unless your governance process permits it; prefer a new version.

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

# Contract Designer — repository instructions

## Purpose
Standalone, product-neutral React/Vite frontend for designing logical business contracts and inspecting inheritance lineage. This is a separate repo from `robin-bajaj/cdo-semantic-governance` and `robin-bajaj/federated-semantic-poc`.

## Contract data model
- Parent definition: `name`, integer `version`, `attributes` (`name`, `data_type`, `description`), `metrics` (`name`, `type`, `agg`, `expr`, optional `fill_nulls_with`).
- Child definition: `name`, integer `version`, `uses: { name, version }`, `include: { attributes, metrics }`.
- Example hierarchy: `cdo.all -> cdo.position` and `cdo.all -> cdo.counterparty`.
- Keep compatibility with the authoritative governance YAML in `cdo-semantic-governance/contracts/`. Never export UI positions, visual state or extra arbitrary metadata inside contract YAML.
- Team semantic entity aliases and CDO composition selections are separate from the logical business contract editor.

## Architecture
- `src/contracts.js`: seeded example contracts, YAML serializer and frontend preflight validation.
- `src/main.jsx`: explorer, editor, import/export and app state.
- `src/ContractCanvas.jsx`: draggable, zoomable and pannable lineage canvas.
- `src/lineage.js`: pure deterministic lineage layout; `src/lineage.test.js`: Node tests.
- `src/styles.css`: existing green-and-white design.

## Operational safety
- Contracts remain local browser drafts until YAML export. Only card position preferences use localStorage.
- No authentication, GitHub write, backend persistence or authoritative server validation exists yet.
- Do not modify governance or federated repositories without explicit approval.
- Python contract registry validation and federated CI remain authoritative.
- Run `npm test` and `npm run build` when changing code, and report unrun checks accurately.
- Make incremental changes through reviewable pull requests.

# Contract Designer repository conventions

## Scope and ownership

The catalog belongs to `robin-bajaj/cdo-semantic-governance/contracts/` on `main`. UI drafts, canvas coordinates and browser preferences must never be represented as approved GitHub contracts or embedded into logical contract YAML. New versions are submitted by PR and validated by the governance repository CI; never modify released versions in place.

## Organization

- `src/main.jsx`: bootstraps React only.
- `src/App.jsx`: assembles workspace and editor behavior.
- `src/domain/contracts/`: pure serialization, validation and version-aware inheritance functions.
- `src/features/canvas/`: layout and graph interactions.
- `src/features/explorer/`: sidebar component.
- `src/features/editor/`: editor sub-components.
- `src/services/github/`: GitHub registry and PR API interactions.
- `src/services/storage/`: cached approved GitHub registry snapshot only.

Use PascalCase for React components, camelCase for non-component files, and colocate `.test.js` files with their modules. Preserve the existing YAML shape (`name`, `version`, `attributes`, `metrics`, `uses`, `include`). Use name+version to resolve every dependency.

## Release discipline

Run `npm ci && npm run check` and review CI before merging. No access token may enter browser storage, URLs, logs, or committed files. Direct browser GitHub token publishing is a prototype limitation and must be replaced with authenticated server-side operations before multi-user production use. Keep changes scoped to this repository unless an independent governance PR is explicitly requested.

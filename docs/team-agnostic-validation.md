# Team-agnostic semantic-model validation

## Purpose
The portal uses one validator for Team A, Team C and any newly registered team.
No validation rule depends on a team name. A team's role is a stable ID such as
`team-risk`, which maps to `team_risk` when building team-owned model paths.

## Team setup
1. On the demo login page, choose **Add another team workspace**. This creates
   a persistent row in the local Team Registry.
2. Sign in as that team (demo-only role selection; this is **not** authentication).
3. In **Team Lead: Manage connections**, link that team's dbt Cloud project and
   GitHub token for its dbt-connected GitHub repository.
4. Independently author staging SQL and semantic YAML using the CDO contract
   selector. The same validator is called regardless of team.

## Validation lifecycle
1. Validate the editor's SQL/YAML shape, model names, inherited attributes,
   metric aliases and selected CDO contract.
2. Retrieve the full project from the team's **verified linked repository** and
   branch. Pin it to an immutable commit SHA; bound archive size, file count and
   extraction paths.
3. Overlay the team's draft SQL and **authored** semantic YAML into a disposable
   checkout. Other committed models in that dbt project remain present.
4. Compile custom `config.meta.uses` CDO inheritance into dbt-native definitions
   **only in the disposable checkout**.
5. Run `dbt deps` if packages/dependencies are defined, then `dbt parse
   --no-partial-parse` and check the resulting manifest.
6. Return actionable diagnostics for known metric and semantic conflicts. A
   local managed-project fallback remains useful when the team has no connected
   project, but does **not** authorize publication.

## Publishing
- A successful connected-project validation is recorded against the exact
  draft content, linked repository and commit SHA.
- Publishing verifies the same linked repository and base revision before
  creating an atomic feature-branch commit and a GitHub pull request.
- Publish **authored YAML** (including `config.meta.uses`) and original SQL,
  never the expanded compiler output.
- Reviewer approval and required GitHub CI checks remain the merge safety net.
- If another team merges to the same target branch, revalidate before publishing.

## Limits
- This is a localhost demonstration. Workspace registration and role selection
  are not secure identity management. Enterprise deployment needs SSO/RBAC,
  centrally managed service tokens, isolation of dbt/Jinja execution, and
  audited background workers.
- Parse is not equivalent to executing SQL or an enforced model contract
  against a warehouse. The release pipeline must still run dbt build/test.
- Validation is scoped to the team's connected dbt project. CDO composition
  across physically independent dbt projects still needs a separate integration
  validation boundary.
- Existing model editing and PR update workflows are separate capabilities;
  this milestone creates new files in the team's linked repository.

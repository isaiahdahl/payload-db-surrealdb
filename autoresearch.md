# Autoresearch: Payload SurrealDB 1.0 conformance

## Objective
Move `payload-db-surrealdb` toward a credible 1.0 by reducing objective failures in Payload's official integration suites while also improving the adapter architecture when conformance is preserved. The immediate 1.0 blockers are joins and queues; query-presets and trash are now green and should remain green. Cleaner modular code is an explicit tie-breaker: if the full objective sweep is unchanged, a behavior-preserving refactor is commit-worthy when it measurably reduces large-file concentration or improves module separation without weakening Payload semantics.

The workload builds the adapter, resets the local SurrealDB `payload` database before each suite, then runs the official suites that define the core 1.0 release bar plus plugin readiness suites from `ROADMAP-1.0.md`.

Core 1.0 suites now included in `blocker_failures`:

1. `test/database/int.spec.ts`
2. `test/auth/int.spec.ts`
3. `test/globals/int.spec.ts`
4. `test/collections-rest/int.spec.ts`
5. `test/collections-graphql/int.spec.ts`
6. `test/fields/int.spec.ts`
7. `test/sort/int.spec.ts`
8. `test/select/int.spec.ts`
9. `test/field-paths/int.spec.ts`
10. `test/query-presets/int.spec.ts`
11. `test/relationships/int.spec.ts`
12. `test/joins/int.spec.ts` — major remaining adapter blocker.
13. `test/uploads/int.spec.ts` — mostly green; known local env may contribute two paste-url failures.
14. `test/dataloader/int.spec.ts`
15. `test/versions/int.spec.ts`
16. `test/localization/int.spec.ts`
17. `test/trash/int.spec.ts`
18. `test/locked-documents/int.spec.ts`
19. `test/queues/int.spec.ts` — major remaining adapter blocker.

Plugin readiness suites are also enabled by default in `autoresearch.sh` and included in `blocker_failures`:

20. `test/plugin-nested-docs/int.spec.ts`
21. `test/plugin-redirects/int.spec.ts`
22. `test/plugin-search/int.spec.ts`
23. `test/plugin-seo/int.spec.ts`
24. `test/plugin-form-builder/int.spec.ts`
25. `test/plugin-multi-tenant/int.spec.ts`

Set `RUN_PLUGIN_SUITES=0 ./autoresearch.sh` only for a quick local diagnostic run. Do not use plugin-disabled runs for keep/discard decisions unless explicitly changing the experiment target and logging a new baseline.

Additional 1.0 readiness items that still need dedicated tests or manual validation and are not fully represented by one existing integration spec:

- rollback on failed create/update hooks
- rollback version writes when parent write fails
- concurrent unique inserts
- concurrent auth login attempt increments
- concurrent draft autosaves
- bulk update/delete behavior
- upsert race behavior
- starter/template end-to-end validation for `examples/basic`, blank template, website template, and ecommerce template

When these checks are implemented as scripts or specs, add them to `autoresearch.sh` and include their failures in `blocker_failures`.

## Metrics
- **Primary conformance metric**: `blocker_failures` (count, lower is better) — failing tests across the full 1.0 objective sweep, including core adapter suites and plugin readiness suites when `RUN_PLUGIN_SUITES` is enabled.
- **Architecture tie-breaker metrics**: `modularity_penalty` (lower is better), `largest_src_file_lines`, `operations_lines`, `relationships_lines`, `src_file_count`, and `large_src_files`. These do not outweigh conformance regressions, but they can justify keeping a refactor when `blocker_failures` and all guardrail suite results are unchanged.
- **Secondary conformance metrics**: per-suite `<suite>_failures` and `<suite>_passed` metrics for every suite listed above, plus `duration_s`, `build_ok`, and `plugin_suites_enabled` — localize progress and monitor runtime.

### Keep / Discard Rules
- Always keep changes that reduce `blocker_failures` without regressing green guardrails.
- Discard changes that increase `blocker_failures`, regress query-presets/trash, break build, or mask/skip/cheat tests, even if the code looks cleaner.
- If `blocker_failures` and suite-level pass/fail counts are unchanged, keep a refactor only when it is objectively more modular. Examples: extracting a coherent concern from `operations.ts` or `relationships.ts` into a focused module, reducing `modularity_penalty`, reducing `largest_src_file_lines`, or reducing `operations_lines` / `relationships_lines` without adding indirection that obscures behavior.
- Do not keep churn-only changes: renames, formatting, tiny helpers, or file splits that do not reduce concentration or clarify ownership should be discarded when conformance is unchanged.

## How to Run
`./autoresearch.sh` — outputs `METRIC name=number` lines.

## Files in Scope
- `src/utilities/relationships.ts` — relationship write/read transforms, join field collection, join population, join sorting/result shape, polymorphic joins. Good refactor candidates: split join collection/resolution/sorting from relationship read/write transforms once behavior is pinned.
- `src/operations.ts` — find/findOne/count/update/delete behavior, client-side where/sort fallback, transaction-doc merging, jobs/updateJobs helpers. Good refactor candidates: extract coherent job, query, sorting, atomic update, and pagination concerns without changing semantics.
- `src/queries/buildWhere.ts` — SurrealQL where compiler, nested path lookup, null/string coercion, hasMany operators.
- `src/transactions/index.ts` — in-memory transaction queue and read-your-writes snapshots.
- `src/versions.ts` — versioned collection querying and draft/version wrappers if joins interact with versions.
- `src/utilities/fields.ts` — schema/path helpers, select projection, field traversal when needed by joins/queues.
- `src/index.ts` — adapter init, schema/table registration, `updateJobs` wiring.
- `README.md` and `ROADMAP-1.0.md` — update suite matrix only after verified improvements.
- `autoresearch.sh` and `autoresearch.md` — keep the objective aligned with all 1.0 release gates; if the suite list changes, treat it as a new experiment target and establish a fresh baseline before comparing results.
- Generated `dist/**` — update via `npm run build` whenever source changes.

## Off Limits
- Do not modify Payload core tests to make them pass.
- Do not change `/var/deployment/payload/payload/test/dbAdapters.ts` except the existing adapter harness import.
- Do not introduce new runtime dependencies unless absolutely necessary.
- Do not replace the adapter with a relational/Postgres-style schema implementation.
- Do not mask failures by skipping tests or weakening Payload behavior.

## Constraints
- Preserve already green suites: database, auth, globals, collections REST/GraphQL, fields, sort, select, field-paths, query-presets, relationships, dataloader, versions, localization, locked-documents, trash, and core smoke/transactions/relationship smoke.
- Keep Payload semantics Mongo-like/schemaless.
- SurrealDB record IDs must remain normalized to Payload IDs.
- Prefer targeted adapter fixes over broad hacks or test-specific conditionals.
- If a change improves one blocker suite but regresses package checks or a green conformance suite, log as `checks_failed`/discard unless the regression is understood and fixed in the same iteration.
- Refactors must be behavior-preserving and validated by the same objective sweep. Prefer small, reversible extractions over broad rewrites.
- Architecture improvements should follow the Mongo adapter's separation of concerns where useful, but should not force a Mongoose/relational design onto SurrealDB.

## Current Baseline
Latest manual state before this autoresearch session:

```txt
test/query-presets/int.spec.ts  11 passed / 1 skipped
test/trash/int.spec.ts          97 passed / 5 todo
test/joins/int.spec.ts          50 passed / 1 skipped / 24 failed
test/queues/int.spec.ts         previously 72 failed / 2 skipped; needs fresh baseline
```

Recent green suites:

```txt
test/select/int.spec.ts         115 passed
test/sort/int.spec.ts            37 passed
test/fields/int.spec.ts         157 passed / 2 skipped
test/localization/int.spec.ts   117 passed
test/versions/int.spec.ts        98 passed
```

## What's Been Tried
- Fixed select and sort suites fully.
- Fixed query-presets lockout by making transaction read snapshots replace same-ID docs and override DB docs during transactional reads.
- Fixed trash suite by coercing REST query-string `equals=null` to true null semantics.
- Started collection-array join shape: docs now use `{ relationTo, value }`; default ordering across collections was adjusted. Sorting/pagination for collection-array joins still needs work because Payload's sanitized joins passed to the adapter often omit requested sort/limit in Local API paths.
- Remaining joins failures cluster around REST/GraphQL join pagination/access/query handling, localized/versioned joins, access filtering, collection-array sorting/filtering, and top-level where queries by join fields that currently time out.
- Queues are the next large 1.0 blocker after joins; expected areas include duplicate user seeding, job claiming/updateJobs, concurrency, and queue state transitions.
- Full 1.0 rubric is not “just joins”: use whatever suite gives the most objective reduction in remaining 1.0 risk. Keep green suites green, reduce blocker failures, and update the roadmap when a suite crosses from failing to green.
- The objective was broadened after run #31 to include all Gate 1-4 suites and Gate 7 plugin readiness suites. The next autoresearch run must establish a fresh baseline for this broader metric before comparing improvements against prior 18/19-failure runs, which used the narrower active-blocker sweep.

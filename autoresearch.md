# Autoresearch: Payload SurrealDB 1.0 conformance

## Objective
Move `payload-db-surrealdb` toward a credible 1.0 by reducing objective failures in Payload's official integration suites. The immediate 1.0 blockers are joins and queues; query-presets and trash are now green and should remain green.

The workload builds the adapter, resets the local SurrealDB `payload` database before each suite, then runs the remaining official suites that best represent 1.0 readiness:

1. `test/joins/int.spec.ts`
2. `test/queues/int.spec.ts`

## Metrics
- **Primary**: `blocker_failures` (count, lower is better) — failing tests across the current 1.0 blocker suites.
- **Secondary**: `joins_failures`, `joins_passed`, `queues_failures`, `queues_passed`, `duration_s`, `build_ok` — localize progress and monitor runtime.

## How to Run
`./autoresearch.sh` — outputs `METRIC name=number` lines.

## Files in Scope
- `src/utilities/relationships.ts` — relationship write/read transforms, join field collection, join population, join sorting/result shape, polymorphic joins.
- `src/operations.ts` — find/findOne/count/update/delete behavior, client-side where/sort fallback, transaction-doc merging, jobs/updateJobs helpers.
- `src/queries/buildWhere.ts` — SurrealQL where compiler, nested path lookup, null/string coercion, hasMany operators.
- `src/transactions/index.ts` — in-memory transaction queue and read-your-writes snapshots.
- `src/versions.ts` — versioned collection querying and draft/version wrappers if joins interact with versions.
- `src/utilities/fields.ts` — schema/path helpers, select projection, field traversal when needed by joins/queues.
- `src/index.ts` — adapter init, schema/table registration, `updateJobs` wiring.
- `README.md` and `ROADMAP-1.0.md` — update suite matrix only after verified improvements.
- Generated `dist/**` — update via `npm run build` whenever source changes.

## Off Limits
- Do not modify Payload core tests to make them pass.
- Do not change `/var/deployment/payload/payload/test/dbAdapters.ts` except the existing adapter harness import.
- Do not introduce new runtime dependencies unless absolutely necessary.
- Do not replace the adapter with a relational/Postgres-style schema implementation.
- Do not mask failures by skipping tests or weakening Payload behavior.

## Constraints
- Preserve already green suites: select, sort, fields, query-presets, trash, core smoke/transactions/relationship smoke.
- Keep Payload semantics Mongo-like/schemaless.
- SurrealDB record IDs must remain normalized to Payload IDs.
- Prefer targeted adapter fixes over broad hacks or test-specific conditionals.
- If a change improves one blocker suite but regresses package checks or a green conformance suite, log as `checks_failed`/discard unless the regression is understood and fixed in the same iteration.

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

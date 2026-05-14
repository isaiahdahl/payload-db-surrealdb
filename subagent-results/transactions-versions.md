# Transactions / Versions Workstream Result

## Implemented

- Request-scoped transaction batching in `src/transactions/index.ts`:
  - `beginTransaction` creates an adapter session ID.
  - write operations receiving `req.transactionID` queue SurrealQL statements instead of executing immediately.
  - `commitTransaction` executes queued statements inside one `BEGIN TRANSACTION ... COMMIT TRANSACTION` block.
  - `rollbackTransaction` discards queued writes.
- Transaction-aware collection and global writes in `src/operations.ts` and `src/globals.ts`.
- Version table initialization in `src/index.ts` for collection versions and global versions.
- Version/draft basics in `src/versions.ts`:
  - consistent create/global-version shapes with timestamps and nested `version.id` removal.
  - atomic latest-version maintenance statements for collection and global versions.
  - `returning === false` handling for create/update version paths.
  - `queryDrafts` filters latest versions, maps draft-field where clauses to `version.*`, and returns draft document shape with parent id.
- Local regression test script `tests/transactions-versions.mjs` covering rollback, commit, latest collection versions, `queryDrafts`, and global versions.
- README transaction/version notes documenting design and remaining concurrency limitations.
- Updated `/var/deployment/payload/payload-db-surrealdb/progress.md`.

## Design decisions

- Chose HTTP SurrealQL transaction blocks over the SDK/session approach to fit the existing adapter client and avoid a broader client-layer rewrite.
- Because SurrealDB HTTP SQL does not expose an interactive transaction session across requests, the adapter queues write statements and commits them as a single atomic block.
- Creates inside transactions generate client-side IDs so Payload can receive a document-shaped response before commit.
- Reads are still executed against committed database state; this is explicitly documented as the main remaining transaction semantic gap.

## Validation

Passed:

```bash
npm run build
npm run smoke
npm run test:transactions
```

Observed local transaction regression result:

```json
{
  "committed": "e7af70d3-7715-4932-9098-3cb8640ed8f8",
  "drafts": 1,
  "versions": 2
}
```

## Remaining gaps / risks

- Reads within an open transaction do not see queued writes; this is not fully equivalent to interactive Payload transaction semantics.
- High-concurrency latest-version/autosave races still need broader stress tests against persistent SurrealDB.
- Localized draft/version behavior is only basic; no full Payload localization conformance coverage was added.
- Focused Payload monorepo suites were not run from this worker because this worktree still uses local Payload shims and has no configured cross-repo harness.

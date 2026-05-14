# Contract / Schema / Migrations Workstream

## Summary
Implemented package/type contract hardening, SurrealDB client/bootstrap validation, table-prefix-aware schema lifecycle, simple index DDL generation, duplicate-error groundwork, and a real migration lifecycle for provided migration functions.

## Changes
- Removed broad `src/payload-shim.d.ts` and `src/node-shim.d.ts`; added real `payload` and `@types/node` dev dependencies and `package-lock.json`.
- Tightened peer dependency to Payload 3.x (`>=3.0.0 <4.0.0`) and marked package as side-effect-free.
- Added `SurrealDBError`, client request timeouts, invalid JSON checks, HTTP/status checks, statement-level SurrealQL error handling, and duplicate/unique error detection groundwork.
- Made bootstrap idempotent and validated: `DEFINE NAMESPACE IF NOT EXISTS`, `DEFINE DATABASE IF NOT EXISTS`, response checks, and post-connect `RETURN true`.
- Added deterministic `tablePrefix` support to collection CRUD, globals, migrations, and system table creation.
- Expanded `init` to create collection tables, configured collection version tables, configured global version tables, and system tables for globals, migrations, jobs, preferences, locks, and trash.
- Added top-level simple field `index` / `unique` scanning and `DEFINE INDEX IF NOT EXISTS` DDL generation.
- Implemented migration record lifecycle: executes provided `up` functions, records batches, executes provided `down` functions for down/reset/refresh/fresh where provided, and continues to track file-only migrations without dynamic TS loading.

## Changed files / diff highlights
- `package.json`, `package-lock.json`: real Payload/Node dev types, tighter peer range, sideEffects metadata.
- `src/client.ts`: robust HTTP client and structured errors.
- `src/index.ts`: bootstrap hardening, schema/table/index lifecycle, table prefix propagation.
- `src/migrations.ts`: migration execution/tracking/reset/down lifecycle.
- `src/utilities/sql.ts`: deterministic prefix-aware table names.
- `src/utilities/fields.ts`: simple index field discovery.
- `src/operations.ts`, `src/globals.ts`: prefix-aware table access and basic duplicate write error tagging.
- `dist/*`: rebuilt outputs from `npm run build`.
- Removed: `src/payload-shim.d.ts`, `src/node-shim.d.ts`.

## Validation
- `npm run build` — passed.
- `npm run smoke` — initially failed with `SurrealDB bootstrap failed: "The namespace 'payload' already exists"`; fixed bootstrap idempotency.
- `npm run build && npm run smoke` — passed. Smoke created, found, updated, and deleted a post successfully.

## Remaining gaps
- Duplicate/unique errors are detected and tagged (`code: DUPLICATE_KEY`) but not yet transformed into Payload's final validation/error shape.
- Migration files are not dynamically imported from TS at runtime; provided compiled migration objects execute, while file-only migrations are only tracked.
- Index DDL intentionally covers only top-level simple scalar fields; nested arrays/groups/blocks, relationship, localized, and compound indexes remain future work.
- Transactions, relationships/joins/localization, and full versions semantics remain outside this workstream.

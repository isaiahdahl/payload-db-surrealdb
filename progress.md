# Progress

## Status
Implemented and locally validated contract/schema/migrations hardening workstream in isolated worktree `s0-0`.

## Tasks
- Removed broad Payload/Node shim declarations and compiled against real `payload` and Node type packages.
- Tightened package peer contract to Payload 3.x and added package-lock/dev type dependencies.
- Hardened SurrealDB HTTP client with request timeouts, structured `SurrealDBError`, invalid JSON handling, statement-level error checks, and duplicate-index detection groundwork.
- Hardened connect/bootstrap with HTTP/status validation, timeout handling, `IF NOT EXISTS` namespace/database creation, and post-bootstrap query validation.
- Added deterministic table-prefix-aware table naming across collection CRUD, globals, system tables, and migrations.
- Expanded init schema lifecycle to create collection tables, version/global-version tables when configured, and Payload-ish system tables for globals, migrations, jobs, preferences, locks, and trash.
- Added simple-field index DDL generation for `index` and `unique` Payload fields.
- Implemented migration lifecycle execution for provided migration `up` functions and best-effort `down` execution for provided migrations during down/reset/refresh/fresh; file-only migrations are tracked without dynamic TS loading.

## Files Changed
- package.json
- package-lock.json
- src/client.ts
- src/index.ts
- src/migrations.ts
- src/globals.ts
- src/operations.ts
- src/utilities/fields.ts
- src/utilities/sql.ts
- removed src/node-shim.d.ts
- removed src/payload-shim.d.ts

## Validation
- `npm run build` passed.
- Initial `npm run smoke` exposed bootstrap idempotency issue (`namespace already exists`); fixed with `IF NOT EXISTS` bootstrap.
- `npm run build && npm run smoke` passed after the fix.

## Notes
Remaining gaps: duplicate errors are identified and tagged as adapter errors but not yet converted into a first-class Payload validation error shape; migration files in TS are not dynamically imported at runtime unless Payload provides compiled migration functions; index DDL covers only top-level simple fields and intentionally skips nested/relationship/localized structures for this workstream.

---

## Status - demo/e2e/CI validation harness
Implemented runnable validation infrastructure in isolated worktree `s0-5` for the basic demo and documented the broader template validation path.

## Tasks - demo/e2e/CI validation harness
- Added Playwright smoke coverage for `examples/basic` that creates/logs in the first admin user, opens Users and Posts admin list routes, creates a Post through REST, verifies REST readback, and verifies the row through SurrealDB `/sql`.
- Added `examples/basic/playwright.config.ts`, `test:e2e`, and `smoke:demo` scripts plus Playwright dev dependency.
- Added GitHub Actions workflow for adapter install/build/smoke and basic demo install/generate/build/browser smoke against a SurrealDB service.
- Added `docs/validation-harness.md` with runnable commands, Payload blank/website/ecommerce template validation instructions, and a compatibility matrix.
- Updated root and demo READMEs with smoke harness commands.
- Added a small adapter resilience fix so missing collection tables read as empty for `find`, `findOne`, and `count`, allowing first-admin/demo boot flows to proceed before explicit table initialization has materialized.

## Files Changed - demo/e2e/CI validation harness
- .github/workflows/validation.yml
- docs/validation-harness.md
- README.md
- package-lock.json
- src/operations.ts
- dist/operations.js
- examples/basic/README.md
- examples/basic/package.json
- examples/basic/package-lock.json
- examples/basic/playwright.config.ts
- examples/basic/tests/demo-smoke.spec.ts

## Validation - demo/e2e/CI validation harness
- `npm ci` passed.
- `npm run build` passed.
- `npm run smoke` passed.
- `cd examples/basic && npm ci` passed.
- `cd examples/basic && npm run generate:types` passed.
- `cd examples/basic && npm run generate:importmap` passed.
- `cd examples/basic && npm run build` passed.
- `cd examples/basic && docker compose down && docker compose up -d surrealdb surrealist && npm run smoke:demo -- --project=chromium` passed headlessly after resetting the in-memory demo DB.

## Notes - demo/e2e/CI validation harness
- Basic demo URLs: Payload/admin at `http://localhost:3010` / `/admin`, REST at `/api/posts`, SurrealDB at `http://localhost:8000`, Surrealist at `http://localhost:8080`.
- Template validation commands are documented but blank/website/ecommerce have not been executed end-to-end in this pass; matrix marks them as not yet recorded with known feature-risk gaps.

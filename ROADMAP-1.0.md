# payload-db-surrealdb 1.0 Roadmap

This document defines the plan to move `payload-db-surrealdb` from alpha proof-of-concept to a production-ready Payload database adapter.

## Current state

The adapter now passes Payload's core database, auth, globals, REST collections, and GraphQL collections integration suites against SurrealDB. Uploads are at 100/102 passing in this environment; the two remaining failures are paste-url localhost status expectations affected by a local nginx service returning 404 on `127.0.0.1:80`, not a database adapter behavior.

The demo runs with:

- Payload admin: http://localhost:3010/admin
- Surrealist: http://localhost:8080
- SurrealDB API: http://localhost:8000

The adapter is not yet production-ready. Remaining hardening includes broader field/relationship/joins/uploads/version/localization/admin suites, durable transaction semantics, concurrency validation, and full Payload test-suite parity.

## 1.0 principle

A 1.0 release must mean the adapter can run normal Payload applications, not just the basic demo. The adapter should either pass Payload's existing cross-adapter suites or have a short, explicit, intentional list of unsupported behavior.

## Release gates

### Gate 1: Basic adapter contract ✅

Required suites:

```bash
PAYLOAD_DATABASE=surrealdb pnpm test:int test/database/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/auth/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/globals/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/collections-rest/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/collections-graphql/int.spec.ts
```

Current status: all Gate 1 suites are green in the latest sweep.

Must support:

- create/find/findOne/update/delete/count/upsert
- globals
- auth user creation/login/session basics
- REST and GraphQL collection CRUD
- timestamps
- custom IDs
- migrations lifecycle basics
- duplicate/unique error mapping where configured

### Gate 2: Field and query parity

Required suites:

```bash
PAYLOAD_DATABASE=surrealdb pnpm test:int test/fields/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/sort/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/select/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/field-paths/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/query-presets/int.spec.ts
```

Current status from the latest sweep:

- `test/fields/int.spec.ts`: 157 passed / 2 skipped.
- `test/field-paths/int.spec.ts`: 2 passed.
- `test/select/int.spec.ts`: 102 passed / 13 failed.
- `test/sort/int.spec.ts`: 30 passed / 7 failed, mostly multi-field/numeric sort parity.
- `test/query-presets/int.spec.ts`: 10 passed / 1 skipped / 1 failed (query preset lockout access edge case).

Must support:

- schema-aware `where` compiler
- nested field paths
- arrays/groups/tabs/blocks
- text/number/date/checkbox/select/json/richText/point fields
- `equals`, `not_equals`, `in`, `not_in`, comparisons, `exists`, `contains`, `like`, `not_like`
- select/projection behavior
- stable multi-field sorting
- true `findDistinct`

### Gate 3: Relationships, uploads, and joins 🚧

Required suites:

```bash
PAYLOAD_DATABASE=surrealdb pnpm test:int test/relationships/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/joins/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/uploads/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/dataloader/int.spec.ts
```

Current relationships status: `test/relationships/int.spec.ts` is green at 57 passed / 3 skipped.

Current dataloader status: `test/dataloader/int.spec.ts` is green at 4 passed.

Current joins status: `test/joins/int.spec.ts` now gets through setup and is partially passing at 49 passed / 1 skipped / 25 failed. Remaining failures are join where filters, localized/versioned joins, access filtering, pagination, and collection-array result shape.

Current uploads status: 100/102 passing after adapter fixes for upload cookie-fetch isolation and localized upload relationships in blocks. The two remaining local failures are environment-sensitive paste-url checks caused by nginx responding on `127.0.0.1:80` / `localhost:80` with 404 where the suite expects a failed/blocked fetch status of 500.

Must support:

- relationship storage/read/write
- hasMany relationships
- polymorphic relationships
- relationship population depth
- upload relationships
- join fields with sorting, filtering, pagination, count, and polymorphic targets
- no N+1 behavior for common admin/API reads

### Gate 4: Drafts, versions, localization, and system collections

Required suites:

```bash
PAYLOAD_DATABASE=surrealdb pnpm test:int test/versions/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/localization/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/trash/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/locked-documents/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/queues/int.spec.ts
```

Current status: `test/versions/int.spec.ts` is green at 98 passed, `test/localization/int.spec.ts` is green at 117 passed, and `test/locked-documents/int.spec.ts` is green at 13 passed. `test/trash/int.spec.ts` is partially passing at 90 passed / 5 todo / 7 failed. `test/queues/int.spec.ts` currently fails broadly (72 failed / 2 skipped), starting with duplicate user seeding / queue concurrency behavior.

Must support:

- drafts
- autosave
- latest version invariants
- global versions
- localized fields and fallback behavior
- localized drafts
- jobs/updateJobs
- locked documents
- trash/soft delete semantics where applicable

### Gate 5: Real transactions and concurrency

Required custom tests:

- rollback on failed create/update hooks
- rollback version writes when parent write fails
- concurrent unique inserts
- concurrent auth login attempt increments
- concurrent draft autosaves
- bulk update/delete behavior
- upsert race behavior

Must support:

- request-scoped transaction semantics compatible with Payload
- rollback and commit correctness
- atomic version/latest updates
- safe unique constraint behavior under concurrency

### Gate 6: Starter/template end-to-end validation

Run against SurrealDB variants of these apps:

1. `examples/basic`
2. Payload blank template
3. Payload website template
4. Payload ecommerce template

Required checks:

```bash
npm run generate:types
npm run generate:importmap
npm run build
npm run dev
```

Browser/API flows:

- create first admin user
- login/logout
- create/edit/delete collection docs
- list collection docs
- create relationships
- upload media where applicable
- create localized content where applicable
- create drafts and publish where applicable
- render frontend pages
- inspect SurrealDB in Surrealist

### Gate 7: Plugin validation

Required suites after core parity:

```bash
PAYLOAD_DATABASE=surrealdb pnpm test:int test/plugin-nested-docs/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/plugin-redirects/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/plugin-search/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/plugin-seo/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/plugin-form-builder/int.spec.ts
PAYLOAD_DATABASE=surrealdb pnpm test:int test/plugin-multi-tenant/int.spec.ts
```

## Implementation workstreams

### A. Type and package hardening

- Remove broad `payload-shim.d.ts` and `node-shim.d.ts`.
- Compile against real Payload and Node types.
- Tighten supported Payload peer range.
- Add CI for build, smoke, and selected conformance tests.

### B. SurrealDB client layer

- Decide raw HTTP vs official SDK.
- Add parameter binding strategy.
- Add request timeouts and structured errors.
- Improve namespace/database bootstrap validation.
- Add durable Docker profile using RocksDB volume in addition to memory profile.

### C. Schema and index lifecycle

- Define deterministic table naming and optional table prefix.
- Create tables for collections, globals, versions, global versions, migrations, jobs, preferences, locks, and trash support.
- Generate `DEFINE INDEX` for `index` and `unique` fields.
- Map duplicate-index errors into Payload-compatible errors.

### D. Query compiler

- Make compiler schema-aware.
- Validate field paths and sort paths.
- Support localized fields, relationships, arrays, blocks, groups, tabs, JSON/richText paths.
- Implement full pagination/count behavior.
- Implement true distinct queries.

### E. Data transforms

- Implement read/write transforms for Payload field types.
- Normalize IDs without corrupting text IDs.
- Handle dates, points, rich text, JSON, arrays, tabs, blocks, upload fields, auth fields.

### F. Relationships and joins

- Decide storage format for relationship fields.
- Implement simple, hasMany, and polymorphic relationships.
- Implement population depth.
- Implement join fields with batching and per-parent limit/count semantics.

### G. Transactions

- Implement Payload-compatible transaction handling.
- If SurrealDB cannot support long-lived request transactions over HTTP, introduce an operation collector or SDK-based session strategy.
- Add concurrency/rollback tests before marking stable.

### H. Versions, drafts, and localization

- Create explicit version/global-version tables.
- Maintain `latest` atomically.
- Implement autosave/snapshot/publishedLocale semantics.
- Implement localized field storage and fallback behavior.

### I. Migrations

- Execute user migration `up/down` functions.
- Preserve and append migration index entries.
- Implement status/down/reset/refresh/fresh correctly.
- Support production migration bundles.

### J. Demo and examples

- Keep `examples/basic` green.
- Add `examples/relationships`.
- Add `examples/localization-drafts`.
- Add `examples/external-catalog` for the Laravel/song-list use case.

## Browser automation plan

For each demo/starter:

1. Start SurrealDB and Surrealist with Docker Compose.
2. Start Payload on a fixed port.
3. Use Playwright/browser agent to:
   - create first admin user
   - log in
   - open each collection list
   - create a document
   - edit it
   - verify it appears in REST API
   - verify data exists in Surrealist/SurrealQL
4. Save logs/screenshots on failure.

## 1.0 acceptance criteria

A 1.0 release is allowed only when:

- all Tier A/B/C/D integration suites are green, or exceptions are documented and intentionally accepted;
- starter template e2e flows are green for blank, website, and ecommerce equivalents;
- transactions and unique indexes are proven under concurrency;
- demo docs are accurate and reproducible from a fresh clone;
- CI runs the adapter against SurrealDB automatically;
- README has a complete compatibility matrix.

# payload-db-surrealdb

Alpha Payload CMS database adapter for [SurrealDB](https://surrealdb.com/).

> Status: `0.2.0-alpha` quality. This adapter now passes several official Payload integration suites, but it is still pre-1.0 and not yet recommended for production workloads.

## Why this exists

The goal is to provide a Payload database adapter that keeps a Mongo-like, schemaless content model while storing documents in SurrealDB. That gives Payload applications flexible editorial modeling while keeping the same datastore externally queryable by other services.

Potential long-term use cases:

- schemaless Payload-managed content tables
- SurrealDB as a shared operational/read model
- external publishing pipelines writing catalog or domain data into SurrealDB
- Payload editorial overlays and curated pages referencing SurrealDB records
- future AI/search/vector metadata attached outside Payload

## Installation

```bash
npm install payload-db-surrealdb
```

```ts
import { buildConfig } from 'payload'
import { surrealAdapter } from 'payload-db-surrealdb'

export default buildConfig({
  db: surrealAdapter({
    url: process.env.SURREALDB_URL || 'http://localhost:8000',
    namespace: process.env.SURREALDB_NAMESPACE || 'payload',
    database: process.env.SURREALDB_DATABASE || 'payload',
    auth: {
      username: process.env.SURREALDB_USER || 'root',
      password: process.env.SURREALDB_PASS || 'root',
    },
  }),
  // ...
})
```

## Local SurrealDB

```bash
docker compose up -d
```

The included compose file runs SurrealDB in memory on `localhost:8000` with `root:root` credentials.

## Current compatibility

This adapter is tested against Payload's own integration suites from a sibling Payload checkout using `PAYLOAD_DATABASE=surrealdb`.

Currently green:

| Suite | Result |
| --- | --- |
| `test/database/int.spec.ts` | 153 passed / 18 skipped |
| `test/auth/int.spec.ts` | 66 passed |
| `test/globals/int.spec.ts` | 13 passed |
| `test/collections-rest/int.spec.ts` | 112 passed / 2 todo |
| `test/collections-graphql/int.spec.ts` | 47 passed |
| `test/relationships/int.spec.ts` | 57 passed / 3 skipped |
| `test/localization/int.spec.ts` | 117 passed |
| `test/versions/int.spec.ts` | 98 passed |
| `test/dataloader/int.spec.ts` | 4 passed |
| `test/fields/int.spec.ts` | 157 passed / 2 skipped |
| `test/field-paths/int.spec.ts` | 2 passed |
| `test/locked-documents/int.spec.ts` | 13 passed |

Known partial/failing suites from the current 1.0 validation sweep:

| Suite | Current result |
| --- | --- |
| `test/uploads/int.spec.ts` | 100 passed / 2 environment-sensitive failures |
| `test/joins/int.spec.ts` | 50 passed / 1 skipped / 24 failed |
| `test/select/int.spec.ts` | 115 passed |
| `test/sort/int.spec.ts` | 37 passed |
| `test/query-presets/int.spec.ts` | 11 passed / 1 skipped |
| `test/trash/int.spec.ts` | 97 passed / 5 todo |
| `test/queues/int.spec.ts` | 72 failed / 2 skipped |

Uploads status:

- `test/uploads/int.spec.ts`: 100 passed / 2 environment-sensitive failures in the current local environment.
- The remaining upload failures are paste-url localhost status expectations affected by a local nginx service responding on `127.0.0.1:80` with `404`; the adapter-side upload relationship and cookie-fetch issues have been fixed.

Still to validate/fix before 1.0:

- joins suite
- remaining joins edge cases
- trash, locked documents, queues
- admin/browser E2E flows across templates
- package-install runtime checks in standalone Payload apps
- concurrency and production durability hardening

## Implemented surface

Current alpha functionality includes:

- `surrealAdapter()` Payload database adapter factory
- SurrealDB HTTP `/sql` client using Node `fetch`
- namespace/database/table bootstrap
- schemaless collection and system tables
- collection CRUD, count, upsert, bulk update/delete
- globals CRUD with access `where` constraints
- Payload ID normalization from SurrealDB record IDs
- custom string and numeric IDs
- relationship/upload write transforms and depth population
- simple, hasMany, polymorphic, localized, nested/block relationship support
- relationship where queries, including nested block/array paths
- relationship sorting by related document properties
- basic reverse join-field resolution
- query operators used by Payload REST/GraphQL suites
- geospatial point query fallbacks for `near`, `within`, and `intersects`
- auth/session/account-lock flows
- migrations collection lifecycle basics
- collection/global versions, drafts, autosave, localized drafts, and publish-specific-locale behavior
- request-scoped SurrealQL transaction batching with commit/rollback
- transaction read-your-writes support for pending relationship validation

## Known limitations

This is not production ready. Important remaining gaps include:

- no long-lived interactive SurrealDB transaction session over HTTP; writes are queued and committed atomically, but semantics are not yet equivalent to mature SQL adapters in every edge case
- join fields need broader conformance, especially polymorphic joins and advanced pagination/filtering
- select projections, multi-field sort parity, join where/access/localization/version edges, and queue/trash behavior still need broader suite hardening
- unique indexes and duplicate error mapping need more concurrency validation
- migrations are intentionally lightweight and schemaless, not a full schema-diff system
- performance and N+1 characteristics need profiling under real admin/API workloads
- full Payload test-suite parity is not complete

## Demo app

A minimal Payload + Next demo app lives in [`examples/basic`](./examples/basic).

```bash
cd examples/basic
cp .env.example .env
docker compose up -d
npm install
npm run dev -- -p 3010
```

Open:

- Frontend: http://localhost:3010
- Admin: http://localhost:3010/admin
- REST API: http://localhost:3010/api/posts
- Surrealist DB UI: http://localhost:8080

Create the first admin user from `/admin`, then create posts in the `posts` collection. The homepage and REST API read through this adapter.

Surrealist connection details:

```txt
Endpoint:  http://localhost:8000
Username:  root
Password:  root
Namespace: payload_demo
Database:  payload_demo
```

## Relationship storage semantics

- Simple `relationship` and `upload` fields are stored as the related document ID scalar.
- `hasMany` `relationship` and `upload` fields are stored as arrays of related document IDs.
- Polymorphic relationships are stored as `{ relationTo, value }`, where `value` is the related document ID; polymorphic `hasMany` fields store arrays of those objects.
- Localized relationships are stored by locale key and collapsed/populated according to Payload read semantics.

Reads convert SurrealDB record IDs back to Payload IDs and support depth population for simple, hasMany, polymorphic, localized, nested/block, and upload relationships.

## Migration philosophy

This adapter intentionally follows a Mongo/Mongoose-like, schemaless philosophy rather than Payload's relational Drizzle/Postgres schema-diff model.

Payload collection fields are not expanded into a large relational table graph. SurrealDB tables are bootstrapped schemaless, with lightweight table/index setup where useful. Migrations should mostly be explicit data transforms and operational bootstrap steps, not generated relational schema churn.

## Development validation

```bash
npm run build
npm run smoke
npm run test:transactions
npm run smoke:relationships
```

Payload integration examples from a sibling Payload checkout:

```bash
PAYLOAD_DATABASE=surrealdb corepack pnpm exec vitest --run --project int test/database/int.spec.ts
PAYLOAD_DATABASE=surrealdb corepack pnpm exec vitest --run --project int test/auth/int.spec.ts
PAYLOAD_DATABASE=surrealdb corepack pnpm exec vitest --run --project int test/globals/int.spec.ts
PAYLOAD_DATABASE=surrealdb corepack pnpm exec vitest --run --project int test/collections-rest/int.spec.ts
PAYLOAD_DATABASE=surrealdb corepack pnpm exec vitest --run --project int test/collections-graphql/int.spec.ts
PAYLOAD_DATABASE=surrealdb corepack pnpm exec vitest --run --project int test/relationships/int.spec.ts
```

## Demo validation harness

The basic demo includes a Playwright browser/API smoke that creates or logs in as the first admin user, opens Users and Posts in the admin UI, creates a Post through the REST API, verifies it through REST, and verifies the stored row with a direct SurrealDB SQL query.

```bash
npm install
npm run build
cd examples/basic
cp .env.example .env
npm install
npx playwright install --with-deps chromium
docker compose up -d surrealdb surrealist
npm run smoke:demo -- --project=chromium
```

See [`docs/validation-harness.md`](./docs/validation-harness.md) for template validation commands and the compatibility matrix for `examples/basic`, Payload blank, website, and ecommerce.

## Publishing status

`0.x` releases are alpha/experimental. Breaking changes should be expected until the adapter passes broad Payload conformance suites and demo/template E2E validation.

Recommended publish command for this release:

```bash
npm publish --tag alpha --access public
```

## License

MIT

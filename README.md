# payload-db-surrealdb

Experimental **alpha** Payload CMS database adapter for [SurrealDB](https://surrealdb.com/).

> Status: `0.1.0-alpha` quality. This package is a working proof of concept, not a production-ready Payload adapter yet.

## Why this exists

The goal is to explore a Payload adapter that keeps Mongo-like content fluidity while storing data in SurrealDB so other systems can query, link, enrich, and extend the same published datastore.

Potential long-term use cases:

- schemaless Payload-managed content tables
- SurrealDB as a shared read model
- external Laravel/MySQL publish pipelines writing catalog data into SurrealDB
- Payload editorial overlays and curated pages referencing external SurrealDB records
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

## Current working surface

This alpha currently has a basic executable adapter scaffold:

- adapter factory: `surrealAdapter()`
- HTTP SurrealQL client using Node `fetch`
- namespace/database bootstrap
- schemaless table init for Payload collections
- basic collection CRUD
- simple `where` compiler
- ID normalization from SurrealDB record IDs to Payload IDs
- relationship/upload storage transforms for simple, hasMany, and polymorphic fields
- basic relationship querying by ID and depth-based population
- basic batched reverse join resolution for simple join fields
- globals basics
- migration file scaffolding basics
- lightweight versions wrappers
- request-scoped SurrealQL transaction batching with commit/rollback
- basic latest-version maintenance for collection/global versions and draft querying

## Known limitations

This is not production ready. Major missing/incomplete areas:

- fully interactive request-scoped transactions with read-your-writes semantics
- complete relationship population parity for all nested/localized field shapes
- complete join fields, including polymorphic joins and full pagination/filtering semantics
- localization semantics
- complete versions/drafts behavior
- unique indexes and duplicate error mapping
- robust migrations lifecycle
- access/query edge cases
- full Payload test-suite parity
- performance/concurrency validation

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

## Transaction and versioning notes

The adapter batches write statements for requests that carry `req.transactionID` and executes them in a single SurrealQL `BEGIN TRANSACTION ... COMMIT TRANSACTION` block on commit. Rollback discards queued writes. This gives atomic commit/rollback for adapter writes, including version/latest maintenance statements.

Known concurrency limits remain: HTTP SurrealQL does not provide an interactive transaction session for reads before commit, so reads inside a pending transaction may not see queued writes. Version `latest` flags are maintained atomically at commit time, but high-contention autosave/publish workloads still need broader Payload conformance and concurrency testing before production use.

## Development smoke test

```bash
npm run build
docker compose up -d
node smoke.mjs
npm run smoke:relationships
```

## Relationship storage semantics

- Simple `relationship` and `upload` fields are stored as the related document ID scalar.
- `hasMany` `relationship` and `upload` fields are stored as arrays of related document IDs.
- Polymorphic relationships are stored as `{ relationTo, value }`, where `value` is the related document ID; polymorphic `hasMany` fields store arrays of those objects.

Reads convert SurrealDB record IDs back to Payload IDs and support basic `depth` population for simple, hasMany, polymorphic, and upload relationships. Reverse `join` fields are resolved in batches for simple `collection`/`on` joins with count metadata, limit, and sort.

## Demo validation harness

The basic demo now includes a Playwright browser/API smoke that creates or logs in as the first admin user, opens Users and Posts in the admin UI, creates a Post through the REST API, verifies it through REST, and verifies the stored row with a direct SurrealDB SQL query.

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

## Payload monorepo test harness

During development this adapter was wired into Payload's test matrix with `PAYLOAD_DATABASE=surrealdb`. The early targeted tests show the approach is viable, but many conformance suites remain to be implemented.

Example from a sibling Payload checkout:

```bash
PAYLOAD_DATABASE=surrealdb corepack pnpm exec vitest --run --project int test/database/int.spec.ts
```

## Versioning

`0.x` releases are alpha/experimental. Breaking changes should be expected until the adapter passes broad Payload database adapter conformance tests.

## License

MIT

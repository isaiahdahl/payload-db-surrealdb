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
- globals basics
- migration file scaffolding basics
- lightweight versions wrappers

## Known limitations

This is not production ready. Major missing/incomplete areas:

- real request-scoped transactions
- relationship population
- join fields
- localization semantics
- complete versions/drafts behavior
- unique indexes and duplicate error mapping
- robust migrations lifecycle
- access/query edge cases
- full Payload test-suite parity
- performance/concurrency validation

## Development smoke test

```bash
npm run build
docker compose up -d
node smoke.mjs
```

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

# Validation harness and compatibility matrix

This repo includes a runnable validation harness for the SurrealDB adapter demo app. It is intentionally focused on proving the admin/API/database loop before claiming broader Payload template compatibility.

## Basic demo smoke

From the repository root:

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

Default URLs:

- Payload frontend: <http://localhost:3010>
- Payload admin: <http://localhost:3010/admin>
- REST API: <http://localhost:3010/api/posts>
- SurrealDB SQL endpoint: <http://localhost:8000/sql>
- Surrealist: <http://localhost:8080>

The Playwright smoke test starts the demo app on port `3010` unless `PLAYWRIGHT_SKIP_WEBSERVER=1` is set. It then:

1. creates or logs in as the first admin user via Payload auth API,
2. logs into the admin UI,
3. opens the Users and Posts list views,
4. creates a Post through the REST API,
5. verifies the Post through the REST API, and
6. verifies the row with a direct SurrealDB SQL query.

Useful environment overrides:

```bash
PORT=3011 \
PAYLOAD_SMOKE_EMAIL=demo-admin@example.com \
PAYLOAD_SMOKE_PASSWORD=demo-password-123456 \
SURREALDB_URL=http://localhost:8000 \
SURREALDB_NAMESPACE=payload_demo \
SURREALDB_DATABASE=payload_demo \
npm run smoke:demo
```

## Payload template validation commands

The upstream Payload templates currently use `@payloadcms/db-mongodb`. To validate this adapter against a template, copy the template into a scratch directory, replace the Mongo adapter with `payload-db-surrealdb`, and run the same commands below. Keep this work outside the published package until the adapter supports the template's required features.

Common patch for `src/payload.config.ts`:

```ts
import { surrealAdapter } from 'payload-db-surrealdb'

// replace db: mongooseAdapter({ url: process.env.DATABASE_URL || '' }) with:
db: surrealAdapter({
  url: process.env.SURREALDB_URL || 'http://localhost:8000',
  namespace: process.env.SURREALDB_NAMESPACE || 'payload_template',
  database: process.env.SURREALDB_DATABASE || 'payload_template',
  auth: {
    username: process.env.SURREALDB_USER || 'root',
    password: process.env.SURREALDB_PASS || 'root',
  },
})
```

Run for each template variant:

```bash
# blank
cp -R /var/deployment/payload/payload/templates/blank /tmp/payload-surreal-blank
cd /tmp/payload-surreal-blank
npm install payload-db-surrealdb@file:/var/deployment/payload/payload-db-surrealdb
npm run generate:types
npm run generate:importmap
npm run build
PORT=3020 npm run dev

# website
cp -R /var/deployment/payload/payload/templates/website /tmp/payload-surreal-website
cd /tmp/payload-surreal-website
npm install payload-db-surrealdb@file:/var/deployment/payload/payload-db-surrealdb
npm run generate:types
npm run generate:importmap
npm run build
PORT=3021 npm run dev

# ecommerce
cp -R /var/deployment/payload/payload/templates/ecommerce /tmp/payload-surreal-ecommerce
cd /tmp/payload-surreal-ecommerce
npm install payload-db-surrealdb@file:/var/deployment/payload/payload-db-surrealdb
npm run generate:types
npm run generate:importmap
npm run build
PORT=3022 npm run dev
```

Browser/API checks to record for each template:

- create first admin user,
- login/logout,
- list major collections,
- create/edit/delete simple collection docs,
- create relationships,
- upload media,
- create drafts and publish where configured,
- create localized content where configured,
- render frontend pages,
- inspect SurrealDB via Surrealist or `/sql`.

## Compatibility matrix

| App / template | Build | Admin boot | CRUD smoke | REST API | Direct SurrealDB query | Known gaps |
| --- | --- | --- | --- | --- | --- | --- |
| `examples/basic` | Automated in CI | Automated Playwright smoke | Automated post create/list | Automated | Automated `/sql` query | Covers only auth users and simple posts. |
| Payload `blank` | Command documented, not yet automated | Not yet recorded | Not yet recorded | Not yet recorded | Not yet recorded | Media/uploads require adapter support beyond the basic demo. |
| Payload `website` | Command documented, not yet automated | Not yet recorded | Not yet recorded | Not yet recorded | Not yet recorded | Relationships, globals, nested docs, redirects/search/SEO plugins, drafts, jobs need validation/support. |
| Payload `ecommerce` | Command documented, not yet automated | Not yet recorded | Not yet recorded | Not yet recorded | Not yet recorded | Ecommerce plugin, relationships, globals, rich text, payments/webhooks, drafts/uploads need validation/support. |

Update this matrix with exact command output and failure notes whenever a template is exercised.

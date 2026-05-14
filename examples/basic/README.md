# Payload + SurrealDB basic demo

This is a minimal Payload app using `payload-db-surrealdb`.

> The adapter is alpha. This demo is meant to prove the basic boot/admin/API loop, not production readiness.

## Run

```bash
cp .env.example .env
docker compose up -d
npm install
npm run dev
```

Open:

- Frontend: http://localhost:3000
- Admin: http://localhost:3000/admin
- REST API: http://localhost:3000/api/posts
- Surrealist DB UI: http://localhost:8080

Create the first admin user from `/admin`, then create posts in the `posts` collection. The homepage reads posts through Payload using the SurrealDB adapter.

Surrealist connection details:

```txt
Endpoint:  http://localhost:8000
Username:  root
Password:  root
Namespace: payload_demo
Database:  payload_demo
```

## Automated smoke

```bash
npm run smoke:demo -- --project=chromium
```

The smoke starts the app on `http://127.0.0.1:3010` by default, creates or logs in as the first admin user, opens Users and Posts in the admin UI, creates a Post through REST, checks `/api/posts`, and verifies the row with SurrealDB `/sql`.

Install the browser once with:

```bash
npx playwright install --with-deps chromium
```

## What this demonstrates

- Payload can boot with `surrealAdapter()`
- Payload can initialize schemaless SurrealDB tables
- Admin can use a simple collection
- REST API and frontend can read from SurrealDB through Payload
- Browser/API/SurrealDB smoke coverage for the basic demo loop

## Known limitations

This does not demonstrate relationships, joins, localization, uploads, or production-grade migrations yet.

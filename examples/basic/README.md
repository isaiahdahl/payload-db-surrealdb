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

Create the first admin user from `/admin`, then create posts in the `posts` collection. The homepage reads posts through Payload using the SurrealDB adapter.

## What this demonstrates

- Payload can boot with `surrealAdapter()`
- Payload can initialize schemaless SurrealDB tables
- Admin can use a simple collection
- REST API and frontend can read from SurrealDB through Payload

## Known limitations

This does not demonstrate relationships, joins, localization, uploads, or production-grade migrations yet.

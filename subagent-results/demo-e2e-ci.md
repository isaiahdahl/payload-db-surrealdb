# Demo E2E/CI validation harness results

## Implemented

- Added Playwright smoke harness for `examples/basic`.
- Added CI workflow at `.github/workflows/validation.yml` for adapter build/smoke and basic demo generate/build/browser smoke against SurrealDB.
- Added validation documentation and compatibility matrix at `docs/validation-harness.md`.
- Updated root and demo READMEs with runnable commands.
- Added a small adapter resilience fix: missing collection tables now read as empty for `find`, `findOne`, and `count`, which keeps first-admin/demo startup paths from failing before explicit table initialization has materialized.

## Smoke coverage

`examples/basic/tests/demo-smoke.spec.ts` now verifies:

1. first admin user creation or login via Payload auth API,
2. authenticated Payload admin browser session,
3. Users list route opens,
4. Posts list route opens,
5. Post creation through REST API,
6. REST API readback from `/api/posts`, and
7. direct SurrealDB `/sql` query for the created post.

## Commands run and results

From repo root:

```bash
npm ci
npm run build
npm run smoke
```

Result: passed.

From `examples/basic`:

```bash
npm ci
npm run generate:types
npm run generate:importmap
npm run build
npx playwright install chromium
docker compose down
docker compose up -d surrealdb surrealist
npm run smoke:demo -- --project=chromium
```

Result: passed headlessly.

## URLs

- Payload frontend/admin: `http://localhost:3010` / `http://localhost:3010/admin`
- Posts REST API: `http://localhost:3010/api/posts`
- SurrealDB SQL endpoint: `http://localhost:8000/sql`
- Surrealist: `http://localhost:8080`

## Compatibility scoreboard

See `docs/validation-harness.md`.

Current status:

- `examples/basic`: automated build/admin/CRUD/REST/SurrealDB smoke passing locally.
- Payload `blank`: validation commands documented; not executed end-to-end in this pass.
- Payload `website`: validation commands documented; not executed end-to-end in this pass.
- Payload `ecommerce`: validation commands documented; not executed end-to-end in this pass.

## Remaining gaps

- Template validation is documented but not automated yet for blank/website/ecommerce.
- The basic smoke intentionally covers simple auth/users/posts only; relationships, uploads, drafts, localization, jobs, globals-heavy templates, and plugin behavior remain adapter readiness gaps.
- CI depends on GitHub Actions service container support for the `surrealdb/surrealdb:latest` image and may need pinning if upstream image behavior changes.

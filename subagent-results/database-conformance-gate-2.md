# Payload database conformance Gate 2

Command:

```bash
PAYLOAD_DATABASE=surrealdb corepack pnpm exec vitest --run --project int test/database/int.spec.ts
```

## Result after this pass

- 171 tests total
- 141 passed
- 12 failed
- 18 skipped

Previous checkpoint was 114 passed / 39 failed / 18 skipped.

## Added in this pass

- Exact `contains` semantics for `hasMany` fields, fixing partial-match false positives.
- Adapter `idType: 'uuid'` compatibility marker so Payload's ID-on-create tests use string IDs.
- Client-side `findDistinct` implementation for several relationship and virtual paths.
- Simple and compound unique preflight checks, including `places(city,country)` schema-hook test coverage.
- Payload-style `ValidationError` mapping for unique field errors.
- Basic `payload.db.tables`/`enums` metadata for custom dbName/schema checks.
- Basic `payload.db.execute` shim for the schema-hook raw SQL smoke.
- `updateVersion`/`updateGlobalVersion` now preserve explicit top-level `createdAt` / `updatedAt`.
- Client-side virtual-field filtering/sorting fallback for adapter `find`/`count` paths.

## Remaining failures

1. Duplicate block row IDs during `payload.duplicate`.
2. Two hasMany/polymorphic `findDistinct` ordering/population edge cases.
3. Custom `dbName` block localized field read shape.
4. Virtual-field query/sort relationship aliases still incomplete for several deep/reference cases.
5. Relationship subquery count.
6. Nested localized polymorphic `$push` / `$remove`.

## Local adapter smoke

Passed:

```bash
npm run build
npm run smoke
npm run test:transactions
npm run smoke:relationships
```

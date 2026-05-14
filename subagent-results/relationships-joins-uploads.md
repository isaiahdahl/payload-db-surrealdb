# Relationships, Joins, Uploads Workstream

## Implemented

- Added relationship write transforms for collection operations.
  - Simple `relationship` and `upload` fields store the related document ID scalar.
  - `hasMany` relationship/upload fields store arrays of related IDs.
  - Polymorphic relationships store `{ relationTo, value }`, with `value` normalized to the related ID; polymorphic `hasMany` stores arrays of those objects.
- Added read transforms with batched depth population for top-level relationship/upload fields.
  - Supports simple, hasMany, polymorphic, and upload relationships.
  - Fetches related docs by target collection and ID set to avoid per-document N+1 for common reads.
- Added relationship-aware query handling.
  - Normalizes relationship where values from document objects to IDs.
  - Supports simple relationship querying by ID.
  - Supports hasMany relationship `equals`/`not_equals` via `CONTAINS`, and basic `in`/`not_in` SQL generation.
- Added a basic batched reverse join resolver.
  - Handles simple join fields with string `collection` and `on` fields.
  - Resolves all parent docs for a field in one target query.
  - Returns count/pagination metadata for hasMany joins and honors field `limit`/`defaultLimit` and `sort`.
- Added `relationship-smoke.mjs` and `npm run smoke:relationships` covering relationship storage/query/population, upload population, polymorphic population, and reverse joins.
- Updated README with current relationship semantics and smoke command.
- Updated `/var/deployment/payload/payload-db-surrealdb/progress.md`.

## Changed files

- `src/utilities/relationships.ts`
- `src/operations.ts`
- `src/queries/buildWhere.ts`
- `package.json`
- `relationship-smoke.mjs`
- `README.md`
- generated `dist/*` from build validation

## Validation

- `npm run build` — passed.
- `npm run smoke` — passed.
- `npm run smoke:relationships` — passed.
- Focused Payload relationship/join/upload suites — not run; no sibling Payload checkout containing the requested test paths was found under `/tmp`.

## Remaining gaps / risks

- Population currently targets top-level relationship/upload fields; nested relationships inside arrays/groups/blocks/localized structures need fuller traversal.
- Join resolver supports simple reverse joins only; polymorphic joins, user-supplied join filtering, arbitrary page offsets, and full Payload join parity remain incomplete.
- Relationship query semantics for polymorphic hasMany and some operators need conformance testing against Payload suites.
- No request-scoped dataloader integration yet, though common find/findOne population batches per operation.

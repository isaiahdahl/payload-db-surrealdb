# Payload database conformance Gate 1

Command run from `/var/deployment/payload/payload`:

```bash
PAYLOAD_DATABASE=surrealdb corepack pnpm exec vitest --run --project int test/database/int.spec.ts
```

## Baseline before this pass

- 171 tests total
- 92 passed
- 61 failed
- 18 skipped

Major failure clusters:

- strict write filtering leaked password/confirm-password and virtual fields
- scalar coercion for text/number fields
- atomic `$inc`, `$push`, `$remove` update operators
- distinct relationship/virtual relationship paths
- unique/index error mapping and compound indexes
- custom dbNames/tables metadata
- version timestamp edge cases
- localization/nested localized relationship atomics

## Fixes landed in this pass

- Added schema-aware write sanitization:
  - strips unknown fields when collection field config is available
  - strips `virtual: true` fields recursively through groups/tabs/arrays/blocks
  - prevents password/confirm-password persistence via unknown-field filtering
- Added basic write coercion:
  - text-like fields stringify scalar input
  - number fields coerce numeric strings, including `hasMany`
  - date values normalize to ISO strings
  - point defaults normalize to Payload's DB-level GeoJSON shape
- Added client-side atomic update support for adapter-level `payload.db.updateOne` calls:
  - `$inc`
  - `$push` with duplicate prevention
  - `$remove`
  - localized/nested paths handled recursively for most cases

## Result after this pass

- 171 tests total
- 114 passed
- 39 failed
- 18 skipped

Remaining failure clusters:

1. Version edge cases
   - custom ID version lookup
   - updateVersion createdAt/updatedAt behavior
   - selected version field edge case
2. ID type mismatch
   - Payload sees this adapter as `text`, so tests that expect numeric IDs still fail.
3. Distinct relationship and virtual relationship paths
   - needs real relationship-aware `findDistinct` planning/population.
4. Compound unique/index parity
   - compound unique indexes are not enforced/mapped yet.
5. Custom dbName/tables metadata
   - `payload.db.tables` compatibility not implemented.
6. Virtual-field query/sort aliases
   - virtual fields now correctly do not persist, but reference-backed query/sort still needs mapping.
7. Relationship referential validation
   - invalid relationship IDs are still accepted.
8. Subquery relationship counts and draft ID-like queries
   - query compiler needs deeper relationship/subquery support.
9. Nested localized polymorphic relationship atomics
   - top-level atomics improved; deepest localized polymorphic paths still fail.

## Local adapter validations

Passed after this pass:

```bash
npm run build
npm run smoke
npm run test:transactions
npm run smoke:relationships
```

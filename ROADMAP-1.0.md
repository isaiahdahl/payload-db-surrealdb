# payload-db-surrealdb 1.0 Readiness

`payload-db-surrealdb` is ready for the 1.0 npm release candidate.

## Final readiness result

Latest full Payload integration-suite readiness sweep:

```txt
blocker_failures = 0
build_ok = 1
```

Green suites in the final sweep:

| Suite | Result |
| --- | --- |
| `test/database/int.spec.ts` | 153 passed |
| `test/auth/int.spec.ts` | 66 passed |
| `test/globals/int.spec.ts` | 13 passed |
| `test/collections-rest/int.spec.ts` | 112 passed |
| `test/collections-graphql/int.spec.ts` | 47 passed |
| `test/fields/int.spec.ts` | 157 passed / 2 skipped |
| `test/sort/int.spec.ts` | 37 passed |
| `test/select/int.spec.ts` | 115 passed |
| `test/field-paths/int.spec.ts` | 2 passed |
| `test/query-presets/int.spec.ts` | 11 passed |
| `test/relationships/int.spec.ts` | 57 passed / 3 skipped |
| `test/joins/int.spec.ts` | 74 passed / 1 skipped |
| `test/uploads/int.spec.ts` | 102 passed |
| `test/dataloader/int.spec.ts` | 4 passed |
| `test/versions/int.spec.ts` | 98 passed |
| `test/localization/int.spec.ts` | 117 passed |
| `test/trash/int.spec.ts` | 97 passed / 5 todo |
| `test/locked-documents/int.spec.ts` | 13 passed |
| `test/queues/int.spec.ts` | 72 passed / 2 skipped |
| `test/plugin-nested-docs/int.spec.ts` | 11 passed |
| `test/plugin-redirects/int.spec.ts` | 3 passed |
| `test/plugin-search/int.spec.ts` | 20 passed |
| `test/plugin-seo/int.spec.ts` | 6 passed |
| `test/plugin-form-builder/int.spec.ts` | 53 passed |
| `test/plugin-multi-tenant/int.spec.ts` | 9 passed |

## Release checklist

- [x] Build passes with `npm run build`.
- [x] Full readiness sweep passes with zero blocker failures.
- [x] Package metadata bumped to `1.0.0`.
- [x] `publishConfig.tag` set to `latest`.
- [x] Autoresearch artifacts removed from the repository.
- [x] `npm pack --dry-run` succeeds.

## Release commands

```bash
git push origin main
git push origin v1.0.0
npm publish --access public
```

## Remaining post-1.0 hardening

These are not blockers for the current readiness gate, but should continue after release:

- profile performance and N+1 behavior on real projects
- validate production SurrealDB deployment, backup, and restore topology
- expand standalone template/admin browser smoke coverage
- continue tracking Payload upstream integration-suite additions

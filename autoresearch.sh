#!/bin/bash
set -euo pipefail

ROOT="/var/deployment/payload"
ADAPTER="$ROOT/payload-db-surrealdb"
PAYLOAD="$ROOT/payload"
TMP="${TMPDIR:-/tmp}"

start=$(python3 - <<'PY'
import time
print(time.time())
PY
)

cd "$ADAPTER"
if npm run build >/tmp/payload-surrealdb-build.log 2>&1; then
  build_ok=1
else
  build_ok=0
  cat /tmp/payload-surrealdb-build.log >&2 || true
  echo "METRIC blocker_failures=999"
  echo "METRIC build_ok=0"
  echo "METRIC modularity_penalty=999999"
  echo "METRIC largest_src_file_lines=999999"
  echo "METRIC operations_lines=999999"
  echo "METRIC relationships_lines=999999"
  echo "METRIC src_file_count=0"
  echo "METRIC large_src_files=999999"
  echo "METRIC duration_s=0"
  exit 0
fi

read modularity_penalty largest_src_file_lines operations_lines relationships_lines src_file_count large_src_files < <(python3 - <<'PY'
from pathlib import Path
src = Path('src')
files = sorted(p for p in src.rglob('*.ts') if p.is_file())
line_counts = {str(p): sum(1 for _ in p.open('r', encoding='utf-8')) for p in files}
operations = line_counts.get('src/operations.ts', 0)
relationships = line_counts.get('src/utilities/relationships.ts', 0)
largest = max(line_counts.values(), default=0)
large_files = sum(1 for count in line_counts.values() if count > 500)
# Lower is better. This deliberately rewards reducing large-file concentration
# while keeping the primary conformance metric separate.
penalty = largest + max(0, operations - 1000) + max(0, relationships - 600) + (large_files * 100)
print(penalty, largest, operations, relationships, len(files), large_files)
PY
)

run_suite() {
  local suite="$1"
  local name="$2"
  local out="$TMP/payload-surrealdb-${name}-autoresearch.log"

  curl -s -u root:root \
    -H 'Surreal-NS: payload' \
    -H 'Surreal-DB: payload' \
    -H 'Accept: application/json' \
    -H 'Content-Type: application/surrealql' \
    --data 'REMOVE DATABASE payload;' \
    http://localhost:8000/sql >/dev/null || true

  if [ "$name" = "uploads" ]; then
    git -C "$PAYLOAD" clean -fdX test/uploads >/dev/null 2>&1 || true
  fi

  cd "$PAYLOAD"
  set +e
  PAYLOAD_DATABASE=surrealdb corepack pnpm exec vitest --run --project int "$suite" >"$out" 2>&1
  local status=$?
  set -e
  echo "===== $suite tail =====" >&2
  tail -80 "$out" >&2 || true

  local clean_out summary
  clean_out="$out.clean"
  perl -pe 's/\x1b\[[0-9;?]*[ -\/]*[@-~]//g' "$out" > "$clean_out" || cp "$out" "$clean_out"
  summary=$(grep -E "Tests  +" "$clean_out" | tail -1 || true)
  local failed passed
  failed=$(python3 - "$summary" "$status" "$clean_out" <<'PY'
import re, sys
s=sys.argv[1]
status=int(sys.argv[2])
path=sys.argv[3]
m=re.search(r'(\d+) failed', s)
if m:
    print(m.group(1))
elif status == 0 and 'passed' in s and 'failed' not in s:
    print('0')
else:
    text=open(path, encoding='utf-8', errors='ignore').read()
    suite_match=re.search(r'Failed Suites\s+(\d+)', text)
    if suite_match:
        print(suite_match.group(1))
    else:
        print('999')
PY
)
  passed=$(python3 - "$summary" <<'PY'
import re, sys
s=sys.argv[1]
m=re.search(r'(\d+) passed', s)
print(m.group(1) if m else '0')
PY
)
  echo "$failed $passed"
}

# Core 1.0 suites from ROADMAP-1.0.md Gates 1-4. These define the primary
# blocker_failures metric. Keep this list broad enough that refactors cannot
# silently regress already-green 1.0 requirements while optimizing joins/queues.
SUITES=(
  "database:test/database/int.spec.ts"
  "auth:test/auth/int.spec.ts"
  "globals:test/globals/int.spec.ts"
  "collections_rest:test/collections-rest/int.spec.ts"
  "collections_graphql:test/collections-graphql/int.spec.ts"
  "fields:test/fields/int.spec.ts"
  "sort:test/sort/int.spec.ts"
  "select:test/select/int.spec.ts"
  "field_paths:test/field-paths/int.spec.ts"
  "query_presets:test/query-presets/int.spec.ts"
  "relationships:test/relationships/int.spec.ts"
  "joins:test/joins/int.spec.ts"
  "uploads:test/uploads/int.spec.ts"
  "dataloader:test/dataloader/int.spec.ts"
  "versions:test/versions/int.spec.ts"
  "localization:test/localization/int.spec.ts"
  "trash:test/trash/int.spec.ts"
  "locked_documents:test/locked-documents/int.spec.ts"
  "queues:test/queues/int.spec.ts"
)

# Post-core plugin suites are part of the 1.0 readiness roadmap. They are
# enabled by default so the objective reflects the full release bar. Set
# RUN_PLUGIN_SUITES=0 only for a quick local diagnostic run, not for keeping
# autoresearch results.
if [ "${RUN_PLUGIN_SUITES:-1}" != "0" ]; then
  SUITES+=(
    "plugin_nested_docs:test/plugin-nested-docs/int.spec.ts"
    "plugin_redirects:test/plugin-redirects/int.spec.ts"
    "plugin_search:test/plugin-search/int.spec.ts"
    "plugin_seo:test/plugin-seo/int.spec.ts"
    "plugin_form_builder:test/plugin-form-builder/int.spec.ts"
    "plugin_multi_tenant:test/plugin-multi-tenant/int.spec.ts"
  )
fi

declare -A failures
declare -A passed
blocker_failures=0

for entry in "${SUITES[@]}"; do
  name="${entry%%:*}"
  suite="${entry#*:}"
  read failures[$name] passed[$name] < <(run_suite "$suite" "$name")
  blocker_failures=$((blocker_failures + failures[$name]))
done

end=$(python3 - <<'PY'
import time
print(time.time())
PY
)
duration=$(python3 - "$start" "$end" <<'PY'
import sys
print(round(float(sys.argv[2])-float(sys.argv[1]), 3))
PY
)

echo "METRIC blocker_failures=$blocker_failures"
for entry in "${SUITES[@]}"; do
  name="${entry%%:*}"
  echo "METRIC ${name}_failures=${failures[$name]}"
  echo "METRIC ${name}_passed=${passed[$name]}"
done
echo "METRIC build_ok=$build_ok"
echo "METRIC modularity_penalty=$modularity_penalty"
echo "METRIC largest_src_file_lines=$largest_src_file_lines"
echo "METRIC operations_lines=$operations_lines"
echo "METRIC relationships_lines=$relationships_lines"
echo "METRIC src_file_count=$src_file_count"
echo "METRIC large_src_files=$large_src_files"
echo "METRIC plugin_suites_enabled=${RUN_PLUGIN_SUITES:-1}"
echo "METRIC duration_s=$duration"

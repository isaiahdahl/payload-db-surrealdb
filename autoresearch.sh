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
  echo "METRIC query_presets_failures=999"
  echo "METRIC query_presets_passed=0"
  echo "METRIC trash_failures=999"
  echo "METRIC trash_passed=0"
  echo "METRIC uploads_failures=999"
  echo "METRIC uploads_passed=0"
  echo "METRIC joins_failures=999"
  echo "METRIC joins_passed=0"
  echo "METRIC queues_failures=999"
  echo "METRIC queues_passed=0"
  echo "METRIC build_ok=0"
  echo "METRIC duration_s=0"
  exit 0
fi

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
  failed=$(python3 - "$summary" "$status" <<'PY'
import re, sys
s=sys.argv[1]
status=int(sys.argv[2])
m=re.search(r'(\d+) failed', s)
if m:
    print(m.group(1))
elif status == 0 and 'passed' in s and 'failed' not in s:
    print('0')
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

read query_presets_failures query_presets_passed < <(run_suite "test/query-presets/int.spec.ts" "query-presets")
read trash_failures trash_passed < <(run_suite "test/trash/int.spec.ts" "trash")
read uploads_failures uploads_passed < <(run_suite "test/uploads/int.spec.ts" "uploads")
read joins_failures joins_passed < <(run_suite "test/joins/int.spec.ts" "joins")
read queues_failures queues_passed < <(run_suite "test/queues/int.spec.ts" "queues")

blocker_failures=$((query_presets_failures + trash_failures + uploads_failures + joins_failures + queues_failures))
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
echo "METRIC query_presets_failures=$query_presets_failures"
echo "METRIC query_presets_passed=$query_presets_passed"
echo "METRIC trash_failures=$trash_failures"
echo "METRIC trash_passed=$trash_passed"
echo "METRIC uploads_failures=$uploads_failures"
echo "METRIC uploads_passed=$uploads_passed"
echo "METRIC joins_failures=$joins_failures"
echo "METRIC joins_passed=$joins_passed"
echo "METRIC queues_failures=$queues_failures"
echo "METRIC queues_passed=$queues_passed"
echo "METRIC build_ok=$build_ok"
echo "METRIC duration_s=$duration"

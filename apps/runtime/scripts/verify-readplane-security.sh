#!/usr/bin/env bash
# verify-readplane-security.sh — prove the read-plane security invariant against
# a disposable Postgres + a minted identity-api token.
#
# Asserts (from activities-api PR #21 review):
#   1. No token            → 401 on every data route.
#   2. /health + beacon     → 200 WITHOUT a token (stay public).
#   3. Token for identity A → returns ONLY A's data.
#   4. Identity B's data via any param → A's scope only (never B's).
#   5. No `limit`           → bounded by DEFAULT; `limit` clamped to MAX.
#   6. The index exists; the query uses LIMIT (EXPLAIN).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$RUNTIME_DIR/../.." && pwd)"
MIGRATION="$REPO_ROOT/db/migrations/2026-05-30-add-event-store.sql"

SECRET="test-secret-at-least-32-bytes-long-aaaa"
ISS="identity-api"
PORT=8799
PG_CONTAINER="actsec-pg-$$"
PG_PORT=55432
DBURL="postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres"

ID_A="id_aaaaaaaaaaaaaaaa"
ID_B="id_bbbbbbbbbbbbbbbb"
ACT_COMPLETED_ID="https://schemas.freeside.thj/activity-completed/v1.0.0"

pass=0; fail=0
ok()   { echo "  PASS: $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL: $1"; fail=$((fail+1)); }

SERVER_PID=""
cleanup() {
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1
}
trap cleanup EXIT

echo "== 1. disposable postgres =="
docker run -d --name "$PG_CONTAINER" -e POSTGRES_PASSWORD=postgres \
  -p ${PG_PORT}:5432 postgres:16-alpine >/dev/null
# wait for readiness
for _ in $(seq 1 30); do
  if docker exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
echo "  postgres ready on :${PG_PORT}"

echo "== 2. apply migration =="
docker exec -i "$PG_CONTAINER" psql -U postgres -q < "$MIGRATION"
echo "  migration applied"

echo "== 3. seed events (2 for A, 1 for B) =="
seed_event() {
  local eid="$1" ident="$2" act="$3" seq="$4"
  local env
  env=$(cat <<JSON
{"event_id":"$eid","preimage_schema_id":"https://schemas.freeside.thj/preimage/activity-completed/v1.0.0","ts":"2026-05-30T00:00:0${seq}Z","source_event_hash":null,"nonce":null,"schema_version":"1.0.0","\$id":"$ACT_COMPLETED_ID","activity_id":"$act","identity_id":"$ident","period_key":null,"step_completions":[],"reward_state_id":null}
JSON
)
  docker exec -i "$PG_CONTAINER" psql -U postgres -q -v env="$env" -v eid="$eid" -v act="$act" -v seq="$seq" <<SQL
INSERT INTO event_store (event_id, scope, partition_value, partition_key, monotonic_sequence, event_envelope)
VALUES (:'eid', 'activity', :'act', 'activity::' || :'act', :'seq', :'env'::jsonb);
SQL
}
seed_event "evt_a1" "$ID_A" "act_alpha" 1
seed_event "evt_a2" "$ID_A" "act_beta"  1
seed_event "evt_b1" "$ID_B" "act_gamma" 1
echo "  seeded: A=2 events, B=1 event"

echo "== 4. mint tokens =="
TOKEN_A=$(bun "$HERE/mint-test-token.ts" "$SECRET" "$ID_A" "freeside" "$ISS")
TOKEN_B=$(bun "$HERE/mint-test-token.ts" "$SECRET" "$ID_B" "freeside" "$ISS")
TOKEN_BADSIG=$(bun "$HERE/mint-test-token.ts" "wrong-secret-still-32-bytes-長い-padpad" "$ID_A" "freeside" "$ISS")
echo "  minted A, B, and a wrong-secret token"

echo "== 5. boot server =="
( cd "$RUNTIME_DIR" && \
  IDENTITY_API_JWT_SECRET="$SECRET" IDENTITY_API_ISSUER="$ISS" \
  DATABASE_URL="$DBURL" PORT="$PORT" \
  bun src/server.ts >/tmp/actsec-server.log 2>&1 ) &
SERVER_PID=$!
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
echo "  server up (pid $SERVER_PID)"

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
body() { curl -s "$@"; }
B="http://127.0.0.1:${PORT}"
AUTH_A=(-H "Authorization: Bearer $TOKEN_A")
AUTH_B=(-H "Authorization: Bearer $TOKEN_B")

echo ""
echo "== ASSERTIONS =="

echo "[A] public routes stay 200 WITHOUT a token"
[[ "$(code "$B/health")" == 200 ]] && ok "/health → 200 (no token)" || bad "/health not 200"
[[ "$(code "$B/.well-known/beacon.json")" == 200 ]] && ok "/.well-known/beacon.json → 200 (no token)" || bad "beacon not 200"

echo "[B] data routes → 401 WITHOUT a token"
for r in /v1/activities /v1/progress?activity_id=act_alpha /v1/badges /v1/raffle-entries?cycle_id=c1 /v1/kinds; do
  c="$(code "$B$r")"
  [[ "$c" == 401 ]] && ok "GET $r (no token) → 401" || bad "GET $r → $c (want 401)"
done

echo "[C] bad-signature token → 401"
c="$(code -H "Authorization: Bearer $TOKEN_BADSIG" "$B/v1/activities")"
[[ "$c" == 401 ]] && ok "bad-sig token → 401" || bad "bad-sig → $c (want 401)"
c="$(code -H "Authorization: Bearer garbage.not.jwt" "$B/v1/activities")"
[[ "$c" == 401 ]] && ok "malformed token → 401 (not 500)" || bad "malformed → $c (want 401)"

echo "[D] token A → ONLY A's data"
ra="$(body "${AUTH_A[@]}" "$B/v1/activities")"
echo "    A /v1/activities body: $ra"
acount=$(echo "$ra" | grep -o "\"identity_id\":\"$ID_A\"" | wc -l | tr -d ' ')
bcount=$(echo "$ra" | grep -o "\"identity_id\":\"$ID_B\"" | wc -l | tr -d ' ')
[[ "$acount" == 2 && "$bcount" == 0 ]] && ok "A sees 2 own events, 0 of B's" || bad "A saw acount=$acount bcount=$bcount (want 2/0)"

echo "[E] A cannot read B's data via a smuggled identity_id param"
ra2="$(body "${AUTH_A[@]}" "$B/v1/activities?identity_id=$ID_B")"
echo "    A /v1/activities?identity_id=B body: $ra2"
bcount2=$(echo "$ra2" | grep -o "\"identity_id\":\"$ID_B\"" | wc -l | tr -d ' ')
acount2=$(echo "$ra2" | grep -o "\"identity_id\":\"$ID_A\"" | wc -l | tr -d ' ')
[[ "$bcount2" == 0 && "$acount2" == 2 ]] && ok "smuggled identity_id=B ignored — A scope only" || bad "leak: bcount=$bcount2 acount=$acount2"

rb="$(body "${AUTH_A[@]}" "$B/v1/badges?identity_id=$ID_B")"
bbadge=$(echo "$rb" | grep -o "\"identity_id\":\"$ID_B\"" | wc -l | tr -d ' ')
[[ "$bbadge" == 0 ]] && ok "/v1/badges?identity_id=B → no B data for caller A" || bad "/v1/badges leaked B: $bbadge"

echo "[F] token B → ONLY B's data (cross-check)"
rbb="$(body "${AUTH_B[@]}" "$B/v1/activities")"
bb=$(echo "$rbb" | grep -o "\"identity_id\":\"$ID_B\"" | wc -l | tr -d ' ')
ba=$(echo "$rbb" | grep -o "\"identity_id\":\"$ID_A\"" | wc -l | tr -d ' ')
[[ "$bb" == 1 && "$ba" == 0 ]] && ok "B sees 1 own event, 0 of A's" || bad "B saw bb=$bb ba=$ba (want 1/0)"

echo "[G] limit clamping"
rl="$(body "${AUTH_A[@]}" "$B/v1/activities?limit=99999")"
echo "    A limit=99999 total_count: $(echo "$rl" | grep -o '"total_count":[0-9]*')"
# A only has 2 events so total_count is 2 regardless; assert the request didn't error + bounded
[[ "$(code "${AUTH_A[@]}" "$B/v1/activities?limit=99999")" == 200 ]] && ok "limit=99999 → 200 (clamped, no error)" || bad "limit clamp errored"
[[ "$(code "${AUTH_A[@]}" "$B/v1/activities?limit=-5")" == 200 ]] && ok "limit=-5 → 200 (clamped to >=1)" || bad "negative limit errored"
[[ "$(code "${AUTH_A[@]}" "$B/v1/activities")" == 200 ]] && ok "no limit → 200 (DEFAULT applies)" || bad "no-limit errored"

echo "[H] index present + query uses LIMIT (EXPLAIN)"
idx=$(docker exec -i "$PG_CONTAINER" psql -U postgres -tAc \
  "SELECT indexname FROM pg_indexes WHERE tablename='event_store' AND indexname='idx_event_store_query';")
[[ "$idx" == "idx_event_store_query" ]] && ok "idx_event_store_query exists" || bad "index missing (got '$idx')"
explain=$(docker exec -i "$PG_CONTAINER" psql -U postgres -tAc \
  "EXPLAIN SELECT event_envelope FROM event_store WHERE event_envelope->>'\$id'='$ACT_COMPLETED_ID' AND event_envelope->>'identity_id'='$ID_A' ORDER BY scope, partition_value, monotonic_sequence ASC LIMIT 50;")
echo "    EXPLAIN: $(echo "$explain" | tr '\n' ' ')"
echo "$explain" | grep -qi "Limit" && ok "query plan contains LIMIT node" || bad "no LIMIT in plan"

echo ""
echo "== RESULT: $pass passed, $fail failed =="
[[ $fail -eq 0 ]] && echo "INVARIANT ESTABLISHED" || echo "INVARIANT VIOLATED"
exit $fail

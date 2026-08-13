#!/usr/bin/env bash
# Sends every webhook fixture in this folder to a running local server and
# prints the response for each. Requires the server to already be running
# (npm run dev) and Postgres reachable.
#
# Usage: bash test-fixtures/webhooks/send-all.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4000}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# If WEBHOOK_SHARED_SECRET is set in .env, the auth check (src/webhooks/auth.ts)
# rejects every request without it — read it the same way the server does,
# straight from .env, rather than requiring it to be exported separately.
# NOTE: extract with grep/cut, not `node -e` + dotenv — dotenv prints a
# banner line to stdout on load, which command substitution would capture
# too, corrupting the value with an embedded newline.
ENV_FILE="$(cd "$DIR/../.." && pwd)/.env"
WEBHOOK_SHARED_SECRET="$(grep '^WEBHOOK_SHARED_SECRET=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2-)"

post() {
  local route="$1" file="$2"
  echo "=== POST $route ($file) ==="
  if [ -n "$WEBHOOK_SHARED_SECRET" ]; then
    curl -s -w "\nHTTP %{http_code}\n" -X POST "$BASE_URL$route" \
      -H "Content-Type: application/json" \
      -H "x-webhook-secret: $WEBHOOK_SHARED_SECRET" \
      -d @"$DIR/$file"
  else
    curl -s -w "\nHTTP %{http_code}\n" -X POST "$BASE_URL$route" \
      -H "Content-Type: application/json" \
      -d @"$DIR/$file"
  fi
  echo
}

post "/users"                     "users.json"
post "/deposits"                  "deposit_initiated.json"
post "/deposits"                  "deposit_initiated_real.json"
post "/deposits/status-update"    "deposit_status_update.json"
post "/withdrawals"               "withdrawal_initiated.json"
post "/withdrawals"               "withdrawal_initiated_real.json"
post "/withdrawals/status-update" "withdrawal_status_update.json"
post "/sportsbook"                "sportsbook.json"
post "/casino"                    "casino.json"
post "/bonuses"                   "bonus_freebet.json"
post "/bonuses"                   "bonus_deposit_pct.json"
post "/bonuses"                   "bonus_freespin.json"
post "/bonuses"                   "bonus_cashback.json"

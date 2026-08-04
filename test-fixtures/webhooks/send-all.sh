#!/usr/bin/env bash
# Sends every webhook fixture in this folder to a running local server and
# prints the response for each. Requires the server to already be running
# (npm run dev) and Postgres reachable.
#
# Usage: bash test-fixtures/webhooks/send-all.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4000}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

post() {
  local route="$1" file="$2"
  echo "=== POST $route ($file) ==="
  curl -s -w "\nHTTP %{http_code}\n" -X POST "$BASE_URL$route" \
    -H "Content-Type: application/json" \
    -d @"$DIR/$file"
  echo
}

post "/users"                     "users.json"
post "/deposits"                  "deposit_initiated.json"
post "/deposits/status-update"    "deposit_status_update.json"
post "/withdrawals"               "withdrawal_initiated.json"
post "/withdrawals/status-update" "withdrawal_status_update.json"
post "/sportsbook"                "sportsbook.json"
post "/casino"                    "casino.json"
post "/bonuses"                   "bonus_freebet.json"
post "/bonuses"                   "bonus_deposit_pct.json"
post "/bonuses"                   "bonus_freespin.json"
post "/bonuses"                   "bonus_cashback.json"

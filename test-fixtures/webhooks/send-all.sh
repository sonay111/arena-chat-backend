#!/usr/bin/env bash
# Sends every webhook fixture in this folder to a running local server and
# prints the response for each. Requires the server to already be running
# (npm run dev) and Postgres reachable.
#
# Usage: bash test-fixtures/webhooks/send-all.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4000}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Confirmed with Satyam (2026-08): webhooks are HMAC-SHA256 signed, envelope
# format {event, eventId, timestamp, data}. Fixtures below are already
# wrapped in that shape; this script signs the raw file bytes and sends
# X-Webhook-Event + X-Webhook-Signature the same way the real platform will.
#
# NOTE: extract the secret with grep/cut, not `node -e` + dotenv — dotenv
# prints a banner line to stdout on load, which command substitution would
# capture too, corrupting the value with an embedded newline.
ENV_FILE="$(cd "$DIR/../.." && pwd)/.env"
WEBHOOK_SIGNING_SECRET="$(grep '^WEBHOOK_SIGNING_SECRET=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2-)"

if [ -z "$WEBHOOK_SIGNING_SECRET" ]; then
  echo "ERROR: WEBHOOK_SIGNING_SECRET is not set in .env — every request below would get 401'd." >&2
  exit 1
fi

post() {
  local route="$1" file="$2"
  local event
  event="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).event)' "$DIR/$file")"
  # awk '{print $NF}' takes the last field regardless of whether this
  # openssl build prefixes the digest with "(stdin)= " or prints it bare.
  local signature
  signature="$(openssl dgst -sha256 -hmac "$WEBHOOK_SIGNING_SECRET" "$DIR/$file" | awk '{print $NF}')"

  echo "=== POST $route ($file, event=$event) ==="
  # --data-binary, NOT -d/--data — plain -d strips embedded newlines from
  # an @file payload (a well-known curl quirk), which silently changes the
  # bytes being sent out from under a byte-exact HMAC signature.
  curl -s -w "\nHTTP %{http_code}\n" -X POST "$BASE_URL$route" \
    -H "Content-Type: application/json" \
    -H "X-Webhook-Event: $event" \
    -H "X-Webhook-Signature: $signature" \
    --data-binary @"$DIR/$file"
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

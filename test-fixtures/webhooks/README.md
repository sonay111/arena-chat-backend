# Webhook test fixtures

Sample payloads based on `docs/tech-crm-webhooks.pdf`, all sharing `USER_ID` /
`PAYMENT_ID` / etc. as the platform ids so they exercise the same
player/wallet upsert paths together.

**Verbatim from the doc:** `users.json`, `deposit_status_update.json`,
`withdrawal_status_update.json`, `sportsbook.json`, `casino.json`, and all
four `bonus_*.json` files.

**Adapted, not verbatim:** `deposit_initiated.json` and
`withdrawal_initiated.json`. The doc only shows one example payload per
payment type (the `.status_updated` shape) — there's no separate documented
example for the `.initiated` event on `/deposits` / `/withdrawals`. These two
files reuse that same shape with the `event` field and `status` changed
(`pending`) and a distinct id, to test the route without misrepresenting it
as an exact doc example.

## Run

```bash
npm run dev                        # server must be running
bash test-fixtures/webhooks/send-all.sh
```

Set `BASE_URL` to point elsewhere, e.g. `BASE_URL=http://localhost:5000 bash test-fixtures/webhooks/send-all.sh`.

## Clean up afterward

The fixtures all reuse the same ids, so re-running is safe (upserts update
in place) — except `raw_webhook_events`, which is append-only by design and
will keep growing. To remove all fixture-generated rows from your local db:

```bash
docker exec -i chat-test-pg psql -U postgres -d chatdb < test-fixtures/webhooks/cleanup.sql
```

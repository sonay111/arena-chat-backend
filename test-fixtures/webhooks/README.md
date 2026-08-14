# Webhook test fixtures

Sample payloads based on `docs/tech-crm-webhooks.pdf`, all sharing `USER_ID` /
`PAYMENT_ID` / etc. as the platform ids so they exercise the same
player/wallet upsert paths together.

**Envelope format (2026-08):** Satyam confirmed HMAC-SHA256 auth and shared
his own verification example, which showed webhooks arrive wrapped in an
envelope — `{event, eventId, timestamp, data}` — not the flat per-domain
shape `docs/tech-crm-webhooks.pdf` documents (that doc matches the older,
superseded README instead). Every fixture below is wrapped in that envelope;
`data` holds exactly what used to be the file's root content. `event` names
and `eventId` values are assumed/assigned (see `src/webhooks/envelope.ts`
for the reasoning) — not independently confirmed for every route, since
Satyam only sent one concrete example. `send-all.sh` signs each fixture's
raw bytes and sends `X-Webhook-Event` / `X-Webhook-Signature`.

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

**Real, verbatim from the platform team:** `deposit_initiated_real.json` and
`withdrawal_initiated_real.json` — the actual `.initiated` payloads Satyam
sent (2026-08). These turned out to differ meaningfully from the adapted
guesses above: no `user`/`wallet` objects at all, a separate `payment_status`
field alongside `status` (`status: "progress"` + `payment_status: "pending"`
on both), and extra fields (`screenshot`, `approval_status`, `is_reapproved`,
`payment_method_id`, `bonusType`) the doc never mentioned. Kept alongside the
older adapted files rather than replacing them, so the gap between guess and
reality stays visible.

## Run

```bash
npm run dev                        # server must be running
bash test-fixtures/webhooks/send-all.sh
```

Set `BASE_URL` to point elsewhere, e.g. `BASE_URL=http://localhost:5000 bash test-fixtures/webhooks/send-all.sh`.

If you're extending this script: use `curl --data-binary @file`, not plain
`-d @file` — the latter silently strips embedded newlines from the file,
which changes the exact bytes sent and breaks HMAC signature verification
(the signature is computed over the file as written to disk).

## Clean up afterward

The fixtures all reuse the same ids, so re-running is safe (upserts update
in place) — except `raw_webhook_events`, which is append-only by design and
will keep growing. To remove all fixture-generated rows from your local db:

```bash
docker exec -i chat-test-pg psql -U postgres -d chatdb < test-fixtures/webhooks/cleanup.sql
```

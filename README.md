# arena-chat-backend

Backend for Arena365's AI live chat support tool. One Node.js service, one Postgres database, three responsibilities:

1. **Real-time chat server** (Socket.io) — customer widget ↔ agent console.
2. **Webhook receiver** (Express) — ingests player-event webhooks pushed by the Arena365 platform (deposits, withdrawals, bets, bonuses, registrations).
3. **CRM API client** — calls the platform's CRM APIs on demand to fetch a player's deposit/withdrawal/bet/bonus history.

All three run in the same process, on the same port, sharing the same database. There is no separate chat service and webhook service — see [`CLAUDE.md`](./CLAUDE.md) if you want the full "why," but for deploying this, that's the whole picture.

## Requirements

- **Node.js 20+** (developed on v20.20.2)
- **PostgreSQL** — locally this runs via Docker; in AWS it's RDS Postgres (see [Deployment](#deployment-notes))

### Local Postgres

Development currently uses a Docker container named `chat-test-pg`, Postgres 16, mapped to a non-default port:

```bash
docker run -d \
  --name chat-test-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=chatdb \
  -p 5433:5432 \
  postgres:16
```

Note the port: **5433**, not the Postgres default 5432. This has to be running before `npm run db:setup` or `npm run dev` will work.

## Setup

```bash
git clone https://github.com/sonay111/arena-chat-backend.git
cd arena-chat-backend
npm install
cp .env.example .env        # then fill in real values, see below
npm run db:setup            # creates all tables, safe to re-run
npm run dev                 # starts the server on :4000
```

`npm run db:setup` runs `src/db-setup.ts`, which creates every table with `CREATE TABLE IF NOT EXISTS` — safe to run again after a pull that adds new tables, it won't touch existing data.

## Environment variables

All of these live in `.env` (gitignored, never committed). `.env.example` has the same keys with placeholder values, and is the only one of the two tracked in git.

| Variable | Purpose | Secret? |
|---|---|---|
| `DATABASE_URL` | Postgres connection string. Local: `postgres://postgres:postgres@localhost:5433/chatdb`. In AWS: the RDS connection string. | Yes in production (RDS credentials); the local default is a throwaway dev password. |
| `WEBHOOK_SHARED_SECRET` | Optional check against an `x-webhook-secret` header on incoming CRM webhooks (see `src/webhooks/auth.ts`). Leave empty to skip the check — this is a placeholder until the platform team confirms their real signing method. | Yes, once set to a real value. |
| `CRM_API_BASE_URL` | Base URL for the platform's CRM API (e.g. `https://adminapistg.arena365backend.com/v1` on staging). Differs between staging and production. | No (not sensitive by itself, but keep it in `.env` since it changes per environment). |
| `CRM_API_TOKEN` | Auth token for the CRM API, sent as the `x-crm-token` header. | **Yes — never commit this.** |

If a token contains special characters (`#`, `"`, etc.), quote it in `.env` — `dotenv` treats an unquoted `#` as a comment marker and will silently truncate the value. Wrap the whole value in single quotes if it contains any of those.

## What it exposes

Everything is served on **port 4000** (hardcoded in `src/server.ts` — no `PORT` env var yet).

- **`GET /health`** — checks the DB connection, returns `{status, db}`. Use this for your load balancer / container health check.
- **8 webhook routes** (all `POST`, all under `/`, see `src/webhooks/`):
  `/users`, `/deposits`, `/deposits/status-update`, `/withdrawals`, `/withdrawals/status-update`, `/sportsbook`, `/casino`, `/bonuses`
- **Socket.io**, mounted on the same HTTP server/port. Events: client emits `join` (with `playerId`) and `message`; server emits `history` (on join) and `message` (broadcast to the conversation's room).

## What it connects to externally

- **Inbound:** the Arena365 platform pushes the 8 webhook events above to this service. They're fire-and-forget with no retries — every payload is logged verbatim to `raw_webhook_events` before any parsing happens, so nothing is lost even if parsing logic has a bug.
- **Outbound:** this service calls the platform's **CRM API** (`src/crm/`) to fetch player data on demand. **The CRM API only accepts requests from allowlisted IPs** — until this service's IP is added to that allowlist, every CRM API call will fail with an `IP address is not allowed` error. That's expected until IP allowlisting happens, not a bug (see `src/crm/errors.ts` — this specific failure has its own error class, `CrmIpNotAllowedError`, so it's never confused with a real outage).

## Project structure

```
src/
├── server.ts        # entry point — wires up Express + Socket.io on one HTTP server
├── db.ts             # Postgres connection pool
├── db-setup.ts        # creates all tables (chat + player-data), re-runnable
├── webhooks/          # the 8 inbound webhook routes + auth + player/wallet upserts
├── crm/               # outbound CRM API client (on-demand player data lookups)
└── guardrails/         # deterministic safety layer for outbound customer-facing
                         # claims — not wired into the chat/webhook flow yet
```

## Testing

```bash
npm run test:webhooks     # posts sample payloads at all 8 webhook routes (server must be running)
npm run test:guardrails   # unit tests for the safety layer (no server needed)
```

There's no test suite for the chat/Socket.io flow yet — `test-client.html` is the manual test harness for that (open it in a browser against a running `npm run dev`).

## Deployment notes

- Intended to run in **AWS**, using **RDS Postgres** as the database (local Docker Postgres is dev-only).
- `DATABASE_URL` and the two `CRM_API_*` variables are the only things that change between staging and production — everything else about the code is identical. Set them via `.env` (or your deployment platform's secret manager) per environment, never hardcode.
- Once deployed, this service will have a **static public IP** that needs to be shared with the platform team so they can **allowlist it** for CRM API access — without that, all CRM API calls fail (see above).
- No `PORT` env var exists yet — port 4000 is hardcoded in `src/server.ts`. If your deployment needs a configurable port, that's a small change worth making before going live.

## Further reading

- [`CLAUDE.md`](./CLAUDE.md) — full project context: ownership split with the platform team, architecture decisions, build phases, open questions.
- [`src/guardrails/README.md`](./src/guardrails/README.md) — the AI safety layer: what each rule does and its limitations.
- `docs/` — the platform team's original spec PDFs (webhook payloads, CRM API guide). Gitignored, not in this repo — ask for these directly if you need them.

# Palig CX Tool

TypeScript/Node service for the CX support agent. It watches the delayed-withdrawal
feed from `arena-chat-backend`, writes honest customer messages with Claude, sends
them into the customer's **CrazyBet chat widget** (via the Support Chat API), and
answers the customer's replies.

## Stack

- TypeScript + Node.js + Express
- Supabase (conversation state, history, scenario context)
- Anthropic API (Claude) for every customer-facing message and for translation
- CrazyBet **Support Chat API**: the only customer channel (send + receive)

## Setup

```bash
npm install
cp .env.example .env
# fill in .env (see below), then:
npm run dev
```

Required settings (the app refuses to start without them, see `src/config.ts`):

- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (service-role key, server-side only)
- `ANTHROPIC_API_KEY`
- `WITHDRAWAL_FEED_URL`

Support Chat (needed to actually deliver messages):

- `SUPPORT_CHAT_API_BASE_URL`, `SUPPORT_CHAT_API_KEY`, `SUPPORT_CHAT_TENANT_DOMAIN`
- `SUPPORT_CHAT_SEND`: real sending happens only when this is exactly `true`.
  Otherwise the agent only logs what it would send (dry run).

Safety switches:

- `TEST_USER_IDS`: comma-separated customer ids that may be messaged.
- `SUPPORT_CHAT_ALLOW_ALL_CUSTOMERS`: when exactly `true`, any customer may be
  messaged, so each withdrawal goes to its own owner. A customer that does not
  exist in Support Chat is skipped with a warning.
- `SUPPORT_CHAT_CUSTOMER_MAP`: optional `agentId:supportChatId` pairs, to reach a
  customer under a different id (for testing).
- `TEST_PAYMENT_IDS`: optional; when set, only these payment ids are acted on.
- `GATEWAY_BROWSER_ALERTS`: the old demo that opens a browser and posts a
  gateway alert; off unless exactly `true`.

Reminders:

- `CHECKIN_INTERVAL_MINUTES` (default `15`) and `MAX_CHECKINS` (default `3`):
  "still pending" reminders per withdrawal, then silence until the status changes.

Other: `PORT` (default `3000`), `POLL_INTERVAL_SECONDS` (default `30`).

## How customer replies arrive

Customers write in the widget; Support Chat signs and delivers each message.
Two doors are available (use the one that matches how Support Chat is configured):

- `POST /support-chat/inbound`: for `arena-chat-backend`, which verifies the
  platform's signature and forwards each message. Auth: `Authorization: Bearer <CX_AGENT_INBOUND_SECRET>`
  (or header `x-cx-agent-secret`). Accepts CrazyBet's payload (`userId`, `body`,
  `messageId`) or `{customerId, text}`.
- `POST /support-chat/webhook`: Support Chat delivers straight to the agent.
  Verified with `SUPPORT_CHAT_WEBHOOK_SECRET` (header `X-Arena365-Signature`).

Both fail closed when their secret is not set, acknowledge immediately, ignore a
repeated `messageId`, and let the agent write the reply in the background.

## Project layout

```
src/
  config.ts                 env loading + validation
  types.ts                  DB row types
  db/                       Supabase client and all reads/writes
  ai/
    client.ts               Anthropic client
    drafts.ts               the agent's rules and prompt for every message
    translate.ts            customer language <-> English
  channels/
    supportChat.ts          send to the customer's widget (dry run, allowlist, id mapping)
  inbound/
    handleCustomerMessage.ts  read a reply, find the withdrawal, answer
  feed/                     withdrawal feed, gateway health
  messages/templates.ts     fixed copy for clarifying questions
  orchestrator/
    poll.ts                 poll cycle: new withdrawals, reminders, resolution
    checkinPolicy.ts        when a reminder is due and what it may promise
  routes/
    supportChatInbound.ts   door for the backend's forwarder
    supportChatWebhook.ts   door for Support Chat's own webhook
    humanRoutes.ts          take-control / release-control (legacy)
    conversationRoutes.ts   read access for dashboards
  server.ts, index.ts
```

## Core flow

1. **Poll** the feed every `POLL_INTERVAL_SECONDS`.
2. **New withdrawal** (a `paymentId` not yet in `conversation_state`): create the
   conversation, write a first message with Claude, send it to the customer's
   widget, record it.
3. **Reminders:** while still pending, a reminder every `CHECKIN_INTERVAL_MINUTES`,
   at most `MAX_CHECKINS`. The agent only mentions a next check if one will happen.
4. **Resolution:** when a withdrawal leaves the feed or changes status, the agent
   tells the customer the honest outcome and marks the conversation resolved.
5. **Replies:** the customer's message is translated, saved, answered by the agent,
   and the answer is saved. There is no human gate: the agent answers every reply.

## Wording rules (in `src/ai/drafts.ts`)

The agent must not: state a status other than the real one, give any timeframe
unless one is verified (there is none yet), say where the money is or that it is
safe, promise a recurring check schedule, invent reasons, or mention internal
details. `src/ai/wording-rules.test.ts` guards the key rules.

## Tests

```bash
npm test
```

## Notes and open items

- **Telegram was removed.** The `telegram_chat_id` column still exists in the
  Supabase `conversation_state` table but nothing reads or writes it.
- `humanRoutes.ts` (take-control / release-control) is legacy; the agent does not
  depend on it.
- The poll cycle re-checks every previously resolved conversation each time; worth
  limiting to open or recently resolved ones.
- `ConversationRole` in `src/types.ts` lacks `'human_agent'`, which `humanRoutes.ts`
  uses (type error in `tsc`).

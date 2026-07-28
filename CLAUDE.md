# CLAUDE.md — AI Live Chat Support Tool (Project Brief)

*This file is the standing context for this project. Read it on every task. It explains what we're building, why, who owns what, the current state, and how I want you to work with me. Detailed how-to lives in the guide files referenced at the bottom.*

---

## Who I am and how to work with me

I'm Sona. This is my **first backend project** and I am learning as I build. So:
- **Go in small steps.** Do only what I ask for that step — never jump ahead and build later phases unprompted.
- **Teach as you go.** After building anything, explain what each file, table, and important line does, in plain language, like you're teaching a first-timer.
- **Prioritize understanding over speed.** There is no deadline. Correct and understood beats fast.
- If I ask for "Step 1," build *only* Step 1, then stop and explain.

---

## What this project is

We're building an **AI-powered live chat support tool** for Arena365, an iGaming (online betting/casino) platform. It lets human support agents handle customer chats with full player context beside them, and later adds an AI layer that drafts replies. This is an **internal tool + a customer-facing chat**, not a CRM (see the naming note below).

**This is the initial version (v0.1).** The goal now is a small, correct, working foundation. We will make it much better over time — this is the start, not the final product. Build things simply and cleanly so they can grow later; don't over-engineer for features we haven't reached.

---

## Current situation (important background)

- Arena365 **currently uses LiveChat** (a third-party chat vendor) for customer support. It's live and handling 100% of support today.
- Previously there was an AI bot on LiveChat that gave poor answers (bad training), so right now **only human agents respond**.
- **Decision (confirmed by Martin, the manager): we are FULLY REPLACING LiveChat** with our own chat system. Not layering on top of it — replacing it entirely. We build our own widget, real-time transport, storage, and agent tools.
- Because we're replacing a live production system, migration will be **gradual and parallel** (run alongside LiveChat, shift traffic slowly, keep rollback) — never a hard switch.

---

## A note on naming: why "CRM" appears

The existing platform's player-data layer is called "CRM" on the tech team's side — the two docs we were given are titled **"Tech CRM Webhooks"** and **"CRM Frontend API Guide."** So whenever "CRM APIs" or "CRM webhooks" come up, it means **the existing Arena365 endpoints we READ player data from** (deposits, withdrawals, balances, bonuses). We are **not building a CRM.** We're building a support tool that consumes those existing data pipes.

---

## Who does what (ownership split — confirmed with the tech team)

There is a **separate tech team** (led by Satyam) that owns the Arena365 platform and infrastructure. Agreed split:

**Their side (infrastructure + data only):**
- Embedding our chat widget on arena365.com's authenticated pages
- Passing the logged-in player's identity into the widget, **signed** (so we can trust who's chatting)
- Hosting our backend + real-time server on **their AWS**, with a managed **Amazon RDS PostgreSQL** database, inside their private network
- Providing player data via the existing CRM APIs + webhooks
- IP allowlisting our backend once it's hosted

**Our side (everything customer/agent/AI-facing):**
- The customer chat **widget** (we build it; they embed it)
- The **real-time server** (WebSocket) + message storage + conversation logic
- The **agent console** — a frontend that lives in **Lovable** (its name isn't final and will likely change)
- The **AI layer** (drafts replies, safety checks) — added later, human-in-the-loop first

---

## What the tech team (Satyam) confirmed

- **The ownership split is approved.**
- **Chat messages:** their team will NOT store or process chat messages. Our **widget sends messages directly to our own backend/real-time server.** So we do NOT need them to build any message webhooks — we own the whole message flow.
- **Hosting:** deploy our backend + WebSocket server within their AWS, using RDS PostgreSQL in the same private network. (This is a LATER step — for now we build and test locally.)
- **Player-event webhooks:** they'll send the deposit/withdrawal/bonus events to our new backend URL. We decided to **replace** the old CRM webhook URL with ours (I never used the old one, so nothing depends on it).
- **IP allowlisting:** once our backend is hosted and has a static public IP, we share it and they allowlist it.

---

## Architecture (the pieces)

```
 Customer widget (we build) ──┐
                               ├── WebSocket server (we build) ── our backend ── Postgres
 Agent console (Lovable) ──────┘        (real-time transport)        │   (conversations,
                                                                      │    messages, player state)
                                                                      ├── CRM APIs (read player data)
                                                                      └── CRM webhooks (player events)
```

- The customer widget and agent console both connect to **our** WebSocket server.
- Our backend persists everything and reads player data from the CRM APIs/webhooks.
- The AI layer (later) joins the message flow as another participant.

---

## Tech stack

- **Backend + real-time server:** Node.js + TypeScript, using **Socket.io** for WebSockets. (Node because this is real-time work and it matches our frontends' language.)
- **Database:** PostgreSQL. Local now (Docker), Amazon RDS later.
- **Frontends:** the agent console lives in **Lovable** (React) — its name isn't final yet. The customer widget will be a lightweight hand-built frontend.
- **AI layer (later):** likely a separate service; may use Claude via API. Human-in-the-loop first, never autonomous at launch.
- **Version control:** Git + GitHub (repo: github.com/sonay111/arena-chat-backend).

---

## Local database (for development)

We use an existing local Postgres running in Docker (container `chat-test-pg`):
- Host: `localhost`
- Port: `5433`  (note: 5433, not the default 5432)
- User: `postgres`
- Password: `postgres`
- Database: `chatdb`
- Connection string: `postgres://postgres:postgres@localhost:5433/chatdb`

In code, always read this from an **`.env`** file (never hardcode it), so switching from local to AWS/RDS later is just a config change. The local password above is a throwaway dev default; real secrets (production DB, CRM token) live only in `.env` and never go to Git.

---

## The two data docs (player data source)

We were given two documents describing how to get Arena365 player data:
1. **CRM webhooks** — the platform pushes real-time events to us: user registration, deposits (+ status updates), withdrawals (+ status updates), sportsbook bets, casino, bonuses. Each event carries the player's `user` object and current `wallet` array. They're fire-and-forget (no retries), so we persist every event on arrival.
2. **CRM APIs** — request/response GET endpoints (staging base `https://adminapistg.arena365backend.com/v1`) to fetch a player's deposits, withdrawals, bets, bonuses, and user list on demand. Token-based auth; IP-allowlisted.

Together: webhooks = real-time awareness; APIs = on-demand lookups + backfill. A webhook receiver for these was already built and tested separately; it will be brought into this backend.

---

## Build order (where we are)

1. **Phase 0 — Setup & Git.** ✅ Done: tools verified, project created, pushed to GitHub.
2. **Phase 1 — Player-data backend.** Bring in the webhook receiver + add the CRM API client. (Can run in parallel.)
3. **Phase 2 — Real-time chat core.** ← current focus. Socket.io server + conversations/messages tables + test client. Persist-before-broadcast.
4. **Phase 3 — Conversation lifecycle & identity** (signed token, history, reconnection).
5. **Phase 4 — Customer widget.** The widget = **look + behavior**, not just a design. To build it we need (a) a rough look/design direction (Arena365 branding — colors, logo, feel; a reference image or sketch helps but isn't required, and it can start plain and improve later), and (b) a clear behavior spec: bubble when closed, panel when open, start a chat, send/receive messages, show typing, reconnect on network drop. Behavior matters more than pixels for v0.1. During Phases 2–3 a throwaway HTML test client stands in for the widget; the real widget replaces it here. Also: coordinate with the tech team on exactly how the signed player identity is passed into the widget (their side embeds it).
6. **Phase 5 — Agent console wired to backend.**
7. **Phase 6 — Player 360 in the console.**
8. **Phase 7 — Supporting systems.**
9. **Phase 8 — AI layer** (co-pilot first).
10. **Phase 9 — Deploy to AWS + gradual migration off LiveChat.**

---

## Rules & habits (always follow these)

1. **Persist before broadcast.** In chat, always save a message to the database BEFORE sending it to anyone. Never lose a message.
2. **Never trust the browser's claimed identity.** Verify the signed player token; don't trust a raw player ID from the frontend.
3. **Secrets never go to Git.** Database passwords, the CRM token, signing keys — all in `.env`, which is gitignored.
4. **Config, not hardcoding.** URLs, tokens, DB connection all come from `.env`, so local→AWS is a config change.
5. **Test every step before moving on.** A piece isn't done until it's proven working.
6. **Small commits, often**, with clear messages.
7. **Keep the two data worlds separate but linked by player id** — chat data (conversations/messages) is ours; player data comes from the CRM side; they join on the player.

---

## Reference guides (detailed how-to)

- **chat-build-guide.md** — step-by-step technical build of the real-time chat core (concepts + code). Use for Phase 2+.
- **master-build-guide.md** — the overall ordered roadmap + tool setup.
- **self-built-chat-plan.md** — architecture & migration strategy.

---

*Remember: this is the initial version. Build it correctly and simply now; we improve it over time.*

# Guardrails — deterministic AI safety layer

Hard-coded checks that sit between anything the system wants to tell a
customer and the customer actually seeing it. **Not AI** — plain
deterministic TypeScript, so a language model can't misinterpret or be
talked around them. This is the structural fix for why the earlier LiveChat
AI bot failed: its rules lived in a prompt, so answers about money rested
on the model's judgement. Here, the check runs in code, after generation,
regardless of what produced the content.

Not integrated into anything yet, and there's no AI agent here — this is
the safety layer alone, built to be wired in later.

## Scope: "outbound claim," not "chat message"

The input is a generic `OutboundClaim` (content + a channel tag), not a
chat-specific type. The product direction includes proactive notifications
and progress trackers ("your withdrawal is progressing normally, ~9
minutes remaining") that make the same kind of factual claims about a
player's money as a chat reply — arguably with less room for error, since
the customer never asked for them. Every rule here works the same whether
the content came from a drafted chat reply or a scheduled notification.

## How it works

- **`types.ts`** — `OutboundClaim`, `ClaimContext` (everything a rule is
  allowed to know), `Rule`, `RuleResult`, `Verdict`.
- **`runner.ts`** — `runGuardrails(claim, context, rules)` runs every rule
  independently and returns a `Verdict` listing **every** failure, not
  just the first — the audit trail and Training Center need the full set
  of violations and their rule ids, not an early exit.
- **`rules/*.ts`** — one file per rule, each exporting a `Rule` (an `id`,
  a `description`, and an `evaluate(claim, context)` function). Each rule
  is independently testable and has no dependency on any other rule.
- **`lib/`** — small shared, purely mechanical helpers (`amounts.ts` for
  currency-tagged number extraction, `withdrawal-claims.ts` for
  withdrawal-completion phrase detection) used by more than one rule.

## The rules

| Rule id | Enforceability |
|---|---|
| `rg-must-escalate` | **Fully enforceable.** Reads a boolean signal only. |
| `require-successful-lookup` | **Fully enforceable.** Reads a status field only. |
| `no-unverified-withdrawal-confirmation` | Partial — phrase-detection half is a heuristic. |
| `no-unverified-amounts` | Partial — number-extraction half is a heuristic (but narrow). |
| `no-promises` | Partial — cannot distinguish promise tense from fact tense. |
| `restricted-account-states` | Partial — disclosure is checked by phrase presence, not comprehension. |
| `no-invented-policy` | **Most semantic rule here.** Numeric assertions are fact-checked reasonably well; non-numeric ones are barely checkable in code. |

Every "Partial" rule has an explicit `LIMITATION` comment at its point of
heuristic judgement, and a `KNOWN LIMITATION` test demonstrating the exact
gap — not just a claim in a comment, a reproducible case. Where a rule
needs real language understanding, the honest fix is an AI verifier as a
second pass behind this deterministic layer, not more regex.

## Running the tests

```bash
npm run test:guardrails
```

81 cases across all 7 rules, the runner, and both shared lib helpers —
pass and fail cases for each, plus the documented limitation cases.

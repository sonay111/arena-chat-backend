import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropicClient } from "../client.js";

const MODEL = "claude-opus-4-8";

// DRAFT — exported on its own so it's easy to review/edit before the first
// real test run. Keep this conservative: the whole point of triage is to
// route accurately, especially for responsible-gambling signals, which the
// guardrails layer (src/guardrails/rg-must-escalate) treats as an
// unconditional escalation regardless of what happens downstream.
export const TRIAGE_SYSTEM_PROMPT = `You are a triage classifier for Arena365 customer support chat messages.

Your only job is to classify the customer's latest message into a fixed set of structured fields. You are not drafting a reply, and you must not explain your reasoning — only the structured fields you're asked for.

Classify:
- intentCategory: what the message is fundamentally about.
- language: the language the customer is writing in.
- sentiment: the customer's emotional tone.
- urgency: how quickly this needs a human response.

Guidance:
- If the message mentions self-exclusion, wanting to stop gambling, losing control, gambling addiction, or any responsible-gambling concern — however it's phrased — classify intentCategory as "responsible_gambling" and urgency as "critical". Err toward this category when in doubt; a false positive here costs a human a few seconds of review, a false negative does not.
- Base the classification only on the latest message, using prior conversation turns only as context to disambiguate (e.g. "yes" replying to a prior question about a deposit).
- If the message is in a language you're not confident about, use "other" rather than guessing.`;

export const TriageOutputSchema = z.object({
  intentCategory: z.enum([
    "deposit_issue",
    "withdrawal_issue",
    "bonus_question",
    "account_access",
    "responsible_gambling",
    "general_question",
    "complaint",
    "other",
  ]),
  // Kept as a small closed set rather than a free-form ISO code — Arena365
  // support traffic is overwhelmingly English/Hindi; "other" covers the
  // rest without asking the model to produce open-ended text.
  language: z.enum(["en", "hi", "other"]),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  urgency: z.enum(["low", "medium", "high", "critical"]),
});

export type TriageOutput = z.infer<typeof TriageOutputSchema>;

export type TriagePriorMessage = {
  senderType: "customer" | "agent" | "ai";
  body: string;
};

// The generic input this agent needs: the message being triaged, plus
// whatever came before it in the same conversation for disambiguation.
export type TriageInput = {
  message: string;
  context?: {
    playerId?: string;
    priorMessages?: TriagePriorMessage[];
  };
};

function buildUserContent(input: TriageInput): string {
  const lines: string[] = [];
  const prior = input.context?.priorMessages ?? [];

  if (prior.length > 0) {
    lines.push("Conversation so far, oldest first:");
    for (const m of prior) {
      lines.push(`[${m.senderType}] ${m.body}`);
    }
    lines.push("");
  }

  lines.push("Message to classify:");
  lines.push(input.message);
  return lines.join("\n");
}

export async function runTriage(input: TriageInput): Promise<TriageOutput> {
  const client = getAnthropicClient();

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 512,
    system: TRIAGE_SYSTEM_PROMPT,
    output_config: {
      // No `thinking` field: triage runs on every incoming chat message and
      // needs to be fast, and classifying into a fixed set of categories
      // isn't the kind of open-ended reasoning adaptive thinking is for.
      // `effort: "low"` for the same reason — this is a deliberate
      // deviation from defaulting to higher effort, made explicitly rather
      // than by omission.
      effort: "low",
      format: zodOutputFormat(TriageOutputSchema),
    },
    messages: [
      {
        role: "user",
        content: buildUserContent(input),
      },
    ],
  });

  if (!response.parsed_output) {
    throw new Error("Triage response did not parse against the expected schema");
  }

  return response.parsed_output;
}

import type { ConversationState } from '../types';

// The shared vocabulary between the dispatcher and the specialists.

/** One problem the system has noticed, in a standard shape. */
export type Case<TRaw = unknown> = {
  /** Stable id for this problem (for a withdrawal, its payment id). One id = one conversation. */
  id: string;
  /** What kind of problem (for example "withdrawal_delay"). Matches a specialist's caseType. */
  type: string;
  /** The customer it concerns. */
  customerId: string;
  /** The detector's own record of the problem, passed through untouched to the specialist. */
  raw: TRaw;
};

export type DispatchContext<TRaw = unknown> = {
  now: Date;
  /** Every case this specialist's detector reported in this cycle. */
  cases: Case<TRaw>[];
};

/**
 * A specialist owns one kind of problem: how to notice it, what to say first, and how to
 * follow it up (reminders, the outcome). The dispatcher decides who handles what and when;
 * the specialist decides the words, using only verified facts.
 */
export interface Specialist<TRaw = unknown> {
  name: string;
  /** The case type this specialist opens conversations for. */
  caseType: string;
  /** Does this specialist own an existing conversation with this category? */
  handlesCategory(category: string | null | undefined): boolean;
  /** Read the current problems from this specialist's signal source. */
  detect(): Promise<Case<TRaw>[]>;
  /** A brand-new case: open the conversation and send the first message. */
  openCase(c: Case<TRaw>, ctx: DispatchContext<TRaw>): Promise<void>;
  /** An existing conversation of this kind. `current` is its case if still reported, else undefined. */
  followUp(convo: ConversationState, current: Case<TRaw> | undefined, ctx: DispatchContext<TRaw>): Promise<void>;
}

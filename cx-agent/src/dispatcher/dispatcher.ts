import type { ConversationState } from '../types';
import { getConversationsForPolling, getKnownPaymentIds, getConversationsForCustomer } from '../db/conversations';
import { shouldDeferNewCase, CROSS_TYPE_COOLDOWN_MINUTES } from './contactPolicy';
import type { Case, DispatchContext, Specialist } from './types';

// The dispatcher: one plain-code (no AI) loop that decides who handles which problem and when.
// It collects problems from every specialist's signal, follows up existing conversations with the
// specialist that owns them, and opens each genuinely new problem once. It writes no message text.

export type DispatcherDeps = {
  getConversations: () => Promise<ConversationState[]>;
  getKnownCaseIds: (ids: string[]) => Promise<Set<string>>;
  getCustomerConversations: (customerId: string) => Promise<ConversationState[]>;
  crossTypeCooldownMinutes: number;
};

export const defaultDispatcherDeps: DispatcherDeps = {
  getConversations: getConversationsForPolling,
  getKnownCaseIds: getKnownPaymentIds,
  getCustomerConversations: getConversationsForCustomer,
  crossTypeCooldownMinutes: CROSS_TYPE_COOLDOWN_MINUTES,
};

export async function runDispatchCycle(
  specialists: Specialist<any>[],
  now: Date = new Date(),
  deps: DispatcherDeps = defaultDispatcherDeps
): Promise<void> {
  // 1. Collect. A specialist whose signal cannot be read is skipped for the WHOLE cycle: without
  //    its cases, every one of its conversations would look as if it had dropped out of the feed
  //    and the agent would announce outcomes that never happened.
  const casesBySpecialist = new Map<Specialist<any>, Case<any>[]>();
  for (const specialist of specialists) {
    try {
      casesBySpecialist.set(specialist, await specialist.detect());
    } catch (err) {
      console.error(`Dispatcher: ${specialist.name} signal could not be read, skipping it this cycle`, err);
    }
  }

  const contextFor = (specialist: Specialist<any>): DispatchContext<any> => ({
    now,
    cases: casesBySpecialist.get(specialist) ?? [],
  });

  // 2. Follow up existing conversations with the specialist that owns each one.
  const conversations = await deps.getConversations();
  const unowned = new Map<string, number>();
  for (const convo of conversations) {
    const specialist = specialists.find((s) => s.handlesCategory(convo.category));
    if (!specialist) {
      const key = convo.category ?? '(none)';
      unowned.set(key, (unowned.get(key) ?? 0) + 1);
      continue;
    }
    if (!casesBySpecialist.has(specialist)) continue; // its signal failed this cycle

    try {
      const current = casesBySpecialist.get(specialist)!.find((c) => c.id === convo.payment_id);
      await specialist.followUp(convo, current, contextFor(specialist));
    } catch (err) {
      console.error(`Poll cycle: failed processing conversation ${convo.conversation_id}`, err);
    }
  }
  if (unowned.size > 0) {
    const summary = [...unowned].map(([category, n]) => `${category}: ${n}`).join(', ');
    console.warn(`Dispatcher: conversations with no specialist were left alone (${summary})`);
  }

  // 3. Open each genuinely new problem, once.
  for (const specialist of specialists) {
    const cases = casesBySpecialist.get(specialist);
    if (!cases) continue;

    const known = await deps.getKnownCaseIds(cases.map((c) => c.id));
    const newCases = cases.filter((c) => !known.has(c.id));

    for (const c of newCases) {
      try {
        if (deps.crossTypeCooldownMinutes > 0) {
          const theirs = await deps.getCustomerConversations(c.customerId);
          if (shouldDeferNewCase(theirs, (cat) => specialist.handlesCategory(cat), now, deps.crossTypeCooldownMinutes)) {
            console.log(`Dispatcher: holding ${c.type} case ${c.id} — customer was just messaged about something else`);
            continue;
          }
        }
        await specialist.openCase(c, contextFor(specialist));
      } catch (err) {
        console.error(`Poll cycle: failed opening ${c.type} case ${c.id}`, err);
      }
    }
  }
}

import { randomUUID } from 'node:crypto';
import { ConversationState } from '../types';
import {
  fetchWithdrawalFeed,
  findMatchingWithdrawal,
  findResolvedOutcome,
  classifyOutcome,
  isApprovedSubmittedRemark,
  isCustomerSafeReason,
  getEtaText,
} from '../feed/withdrawalFeed';
import { FeedAlert } from '../feed/types';
import {
  countOpenConversationsForCustomer,
  createConversation,
  updateConversation,
  insertScenarioContext,
  getScenarioContext,
} from '../db/conversations';
import { draftAgentMessage, WithdrawalStatus } from '../ai/drafts';
import { shouldCheckIn, nextCheckInMinutes } from '../orchestrator/checkinPolicy';
import { resolvedWhileTakenOverNote } from '../messages/templates';
import { logAndMaybeSend, getRecentHistory } from './shared';
import type { Case, DispatchContext, Specialist } from '../dispatcher/types';

// The Withdrawal & Cashier specialist: delayed withdrawals. The functions below were moved,
// unchanged, out of orchestrator/poll.ts when the dispatcher was introduced.

const APPROVED_SUBMITTED_PROGRESS_NOTE =
  'The withdrawal has been approved internally and submitted to the payment provider for confirmation. It is not yet complete — the provider still needs to confirm before it can be marked complete.';

const STATUS_MAP: Record<string, WithdrawalStatus> = {
  completed: 'COMPLETED',
  rejected: 'REJECTED',
  failed: 'FAILED',
};

async function handleNewWithdrawal(alert: FeedAlert, now: Date, allAlerts: FeedAlert[]): Promise<void> {
  const matched = findMatchingWithdrawal(alert);
  const etaText = getEtaText(alert);

  const resolvedAmount = Number(alert.amount) || matched?.amount || null;
  const resolvedCurrency = alert.currency ?? matched?.currency ?? null;

  const conversation: ConversationState = {
    conversation_id: randomUUID(),
    customer_id: alert.userId,
    payment_id: alert.paymentId,
    status: 'autonomous',
    reason: matched?.remark ?? null,
    category: 'withdrawal_delay',
    priority: null,
    amount: resolvedAmount,
    currency: resolvedCurrency,
    customer_name: alert.player?.identity?.username ?? null,
    vip: null,
    taken_over_by: null,
    checkin_count: 0,
    first_seen_at: alert.createdAt,
    agent_last_message_at: null,
    last_webhook_flag_at: null,
    last_known_status: alert.status ?? matched?.status ?? null,
    last_known_remark: matched?.remark ?? null,
    pending_update_count: 0,
    reason_is_customer_safe: isCustomerSafeReason(matched?.remark),
  };

  await createConversation(conversation);
  await insertScenarioContext({
    conversation_id: conversation.conversation_id,
    customer_id: conversation.customer_id,
    event_type: 'withdrawal_delay',
    event_payload: alert as unknown as Record<string, unknown>,
    objective:
      'Reassure the customer about a delayed withdrawal without asserting an unverified root cause, and keep them updated until it resolves.',
    eta_text: etaText,
  });

  const openCount = await countOpenConversationsForCustomer(conversation.customer_id);
  const has_multiple_open_withdrawals = openCount > 1;

  if (alert.status !== 'pending') {
    const outcome = findResolvedOutcome(alert.paymentId, allAlerts);
    const category = outcome?.category ?? 'unknown';

    if (category === 'unknown') {
      // fall through to normal pending flow
    } else {
      const output = await draftAgentMessage({
        withdrawal_id: conversation.payment_id,
        amount: conversation.amount,
        currency: conversation.currency,
        current_status: STATUS_MAP[category],
        verified_customer_reason: outcome?.rawRemark ?? null,
        reason_is_customer_safe: isCustomerSafeReason(outcome?.rawRemark),
        next_step_instructions: null,
        verified_timeframe: null,
        trigger_type: 'AUTOMATED_LOOP',
        next_check_in_minutes: null,
        pending_update_count: 0,
        has_multiple_open_withdrawals,
        message_history: [],
      });

      if (output.send) {
        await logAndMaybeSend({ conversation, role: 'agent', message: output.message, sendToCustomer: true });
      }
      await updateConversation(conversation.conversation_id, {
        status: 'resolved',
        resolution_outcome: category,
        resolution_reason: outcome?.rawRemark ?? null,
      });
      return;
    }
  }

  const initialProgressNote = isApprovedSubmittedRemark(matched?.remark) ? APPROVED_SUBMITTED_PROGRESS_NOTE : null;

  const output = await draftAgentMessage({
    withdrawal_id: conversation.payment_id,
    amount: conversation.amount,
    currency: conversation.currency,
    current_status: 'PENDING',
    verified_customer_reason: conversation.reason,
    reason_is_customer_safe: conversation.reason_is_customer_safe ?? false,
    next_step_instructions: null,
    verified_timeframe: etaText,
    trigger_type: 'AUTOMATED_LOOP',
    next_check_in_minutes: nextCheckInMinutes(0),
    pending_update_count: 0,
    progress_update: initialProgressNote,
    has_multiple_open_withdrawals,
    message_history: [],
  });

  if (output.send) {
    await logAndMaybeSend({ conversation, role: 'agent', message: output.message, sendToCustomer: true });
    await updateConversation(conversation.conversation_id, {
      pending_update_count: 1,
      agent_last_message_at: now.toISOString(),
    });
  }
}

async function handleResolved(convo: ConversationState, allAlerts: FeedAlert[]): Promise<void> {
  console.log(`handleResolved called for payment_id=${convo.payment_id}`);
  const humanOwnsIt = Boolean(convo.taken_over_by);

  const outcome = findResolvedOutcome(convo.payment_id, allAlerts)
    ?? (convo.last_known_status
          ? {
              category: classifyOutcome(convo.last_known_status, convo.last_known_remark),
              rawStatus: convo.last_known_status,
              rawRemark: convo.last_known_remark,
            }
          : null);

  const category = outcome?.category ?? 'unknown';
  console.log(`handleResolved: payment_id=${convo.payment_id} category=${category} humanOwnsIt=${humanOwnsIt}`);

  if (category === 'unknown') {
    console.log(`handleResolved: payment_id=${convo.payment_id} category is unknown, holding for next cycle`);
    return;
  }

  if (convo.status === 'resolved' && convo.resolution_outcome === category) {
    return;
  }

  if (humanOwnsIt) {
    await logAndMaybeSend({
      conversation: convo,
      role: 'system',
      message: resolvedWhileTakenOverNote(convo.payment_id),
      sendToCustomer: false,
    });
    await updateConversation(convo.conversation_id, {
      status: 'resolved',
      resolution_outcome: category,
      resolution_reason: outcome?.rawRemark ?? null,
    });
    return;
  }

  const [scenario, history, openCount] = await Promise.all([
    getScenarioContext(convo.conversation_id),
    getRecentHistory(convo.conversation_id),
    countOpenConversationsForCustomer(convo.customer_id),
  ]);

  const output = await draftAgentMessage({
    withdrawal_id: convo.payment_id,
    amount: convo.amount,
    currency: convo.currency,
    current_status: STATUS_MAP[category],
    verified_customer_reason: outcome?.rawRemark ?? null,
    reason_is_customer_safe: isCustomerSafeReason(outcome?.rawRemark),
    next_step_instructions: null,
    verified_timeframe: scenario?.eta_text ?? null,
    trigger_type: 'AUTOMATED_LOOP',
    next_check_in_minutes: null,
    pending_update_count: convo.pending_update_count,
    has_multiple_open_withdrawals: openCount > 1,
    message_history: history,
  });

  console.log(`handleResolved: draftAgentMessage returned send=${output.send} for payment_id=${convo.payment_id}`);

  if (output.send) {
    await logAndMaybeSend({ conversation: convo, role: 'agent', message: output.message, sendToCustomer: true });
  }
  await updateConversation(convo.conversation_id, {
    status: 'resolved',
    resolution_outcome: category,
    resolution_reason: outcome?.rawRemark ?? null,
  });
  console.log(`handleResolved: payment_id=${convo.payment_id} marked resolved (outcome=${category})`);
}

async function sendProgressUpdate(convo: ConversationState): Promise<void> {
  if (convo.taken_over_by) return;

  const [scenario, history, openCount] = await Promise.all([
    getScenarioContext(convo.conversation_id),
    getRecentHistory(convo.conversation_id),
    countOpenConversationsForCustomer(convo.customer_id),
  ]);

  const output = await draftAgentMessage({
    withdrawal_id: convo.payment_id,
    amount: convo.amount,
    currency: convo.currency,
    current_status: 'PENDING',
    verified_customer_reason: null,
    reason_is_customer_safe: true,
    next_step_instructions: null,
    verified_timeframe: scenario?.eta_text ?? null,
    trigger_type: 'AUTOMATED_LOOP',
    next_check_in_minutes: nextCheckInMinutes(convo.checkin_count),
    pending_update_count: convo.pending_update_count,
    progress_update: APPROVED_SUBMITTED_PROGRESS_NOTE,
    has_multiple_open_withdrawals: openCount > 1,
    message_history: history,
  });

  if (output.send) {
    await logAndMaybeSend({ conversation: convo, role: 'agent', message: output.message, sendToCustomer: true });
    await updateConversation(convo.conversation_id, {
      pending_update_count: convo.pending_update_count + 1,
      status: 'monitoring',
      agent_last_message_at: new Date().toISOString(),
    });
  }
}

async function maybeCheckin(convo: ConversationState, now: Date): Promise<void> {
  if (convo.taken_over_by) return;
  if (convo.status !== 'autonomous' && convo.status !== 'monitoring') return;
  if (!convo.agent_last_message_at) return;

  const minutesSinceLastMessage =
    (now.getTime() - new Date(convo.agent_last_message_at).getTime()) / 60000;
  if (!shouldCheckIn(convo.checkin_count, minutesSinceLastMessage)) return;

  const [scenario, history, openCount] = await Promise.all([
    getScenarioContext(convo.conversation_id),
    getRecentHistory(convo.conversation_id),
    countOpenConversationsForCustomer(convo.customer_id),
  ]);

  const output = await draftAgentMessage({
    withdrawal_id: convo.payment_id,
    amount: convo.amount,
    currency: convo.currency,
    current_status: 'PENDING',
    verified_customer_reason: convo.reason,
    reason_is_customer_safe: convo.reason_is_customer_safe ?? false,
    next_step_instructions: null,
    verified_timeframe: scenario?.eta_text ?? null,
    trigger_type: 'AUTOMATED_LOOP',
    // this reminder counts as sent; only promise another check if one will really follow
    next_check_in_minutes: nextCheckInMinutes(convo.checkin_count + 1),
    pending_update_count: convo.pending_update_count,
    has_multiple_open_withdrawals: openCount > 1,
    message_history: history,
  });

  if (output.send) {
    await logAndMaybeSend({ conversation: convo, role: 'agent', message: output.message, sendToCustomer: true });
    await updateConversation(convo.conversation_id, {
      checkin_count: convo.checkin_count + 1,
      pending_update_count: convo.pending_update_count + 1,
      status: 'monitoring',
      agent_last_message_at: now.toISOString(),
    });
  }
}

/** The withdrawal signal: the delayed-withdrawal feed, one case per payment. */
async function detectWithdrawalCases(): Promise<Case<FeedAlert>[]> {
  const alerts = await fetchWithdrawalFeed();
  return alerts.map((alert) => ({ id: alert.paymentId, type: 'withdrawal_delay', customerId: alert.userId, raw: alert }));
}

/** Follow up one existing conversation: progress update, reminder, or the outcome. */
async function followUpWithdrawal(
  convo: ConversationState,
  current: Case<FeedAlert> | undefined,
  ctx: DispatchContext<FeedAlert>
): Promise<void> {
  const alerts = ctx.cases.map((c) => c.raw);
  const now = ctx.now;
  const feedAlert = current?.raw;
  let progressTransition = false;

  if (feedAlert) {
    const matched = findMatchingWithdrawal(feedAlert);

    const effectiveStatus =
      feedAlert.status && feedAlert.status !== 'pending'
        ? feedAlert.status
        : (matched?.status ?? feedAlert.status ?? null);
    // Same reasoning as findResolvedOutcome in withdrawalFeed.ts: prefer
    // the top-level feedAlert.reason (updates promptly) over the nested
    // recentWithdrawals remark (can stay stale/frozen for hours after
    // resolution — confirmed live on payment_id
    // 6ab4b5880ec99d159c97150f on 2026-09-24).
    const effectiveRemark = feedAlert.reason ?? matched?.remark ?? null;

    const wasApprovedSubmitted = isApprovedSubmittedRemark(convo.last_known_remark);
    const isApprovedSubmittedNow = isApprovedSubmittedRemark(effectiveRemark);
    progressTransition =
      convo.status !== 'resolved' &&
      feedAlert.status === 'pending' &&
      isApprovedSubmittedNow &&
      !wasApprovedSubmitted;

    await updateConversation(convo.conversation_id, {
      last_known_status: effectiveStatus,
      last_known_remark: effectiveRemark,
    });
    convo.last_known_status = effectiveStatus;
    convo.last_known_remark = effectiveRemark;
  }

  const stillPending = feedAlert ? feedAlert.status === 'pending' : false;
  // Logs every conversation the poller knows about — not gated by
  // TEST_USER_IDS in any way. That setting only affects whether a
  // message actually gets delivered (canMessageCustomer), never
  // what's printed here. amount/currency/payment_id (used as the
  // customer-facing reference) are included so a withdrawal's details
  // are visible without cross-checking the Lovable dashboard.
  console.log(
    `payment_id=${convo.payment_id} status=${convo.status} amount=${convo.amount ?? 'null'} currency=${convo.currency ?? 'null'} feedAlert.status=${feedAlert?.status ?? 'NOT IN FEED'} stillPending=${stillPending}`
  );

  if (!stillPending) {
    await handleResolved(convo, alerts);
  } else if (progressTransition) {
    await sendProgressUpdate(convo);
  } else {
    await maybeCheckin(convo, now);
  }
}

export const withdrawalSpecialist: Specialist<FeedAlert> = {
  name: 'withdrawal',
  caseType: 'withdrawal_delay',
  // 'withdrawal' is the older default category on early rows.
  handlesCategory: (category) => category === 'withdrawal_delay' || category === 'withdrawal' || !category,
  detect: detectWithdrawalCases,
  openCase: (c, ctx) => handleNewWithdrawal(c.raw, ctx.now, ctx.cases.map((x) => x.raw)),
  followUp: followUpWithdrawal,
};

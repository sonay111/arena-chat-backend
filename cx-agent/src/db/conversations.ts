import { supabase } from './supabase';
import { ConversationState, ConversationHistoryRow, ScenarioContextRow, ConversationStatus } from '../types';

const ALL_STATUSES: ConversationStatus[] = ['autonomous', 'monitoring', 'human_required', 'resolved'];

export async function getOpenConversations(): Promise<ConversationState[]> {
  const { data, error } = await supabase.from('conversation_state').select('*').neq('status', 'resolved');
  if (error) throw new Error(`Supabase error (getOpenConversations): ${error.message}`);
  return (data ?? []) as ConversationState[];
}

// Counts how many non-resolved conversations a customer currently has, across
// every channel — used to decide has_multiple_open_withdrawals for
// draftAgentMessage, so the reference number gets restated on every message
// once a customer has more than one withdrawal open at the same time.
export async function countOpenConversationsForCustomer(customerId: string): Promise<number> {
  const { count, error } = await supabase
    .from('conversation_state')
    .select('*', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .neq('status', 'resolved');
  if (error) {
    console.error(`Supabase error (countOpenConversationsForCustomer): ${error.message}`);
    return 0; // fail safe: behave as single-withdrawal rather than throw
  }
  return count ?? 0;
}

export async function getConversationsForPolling(): Promise<ConversationState[]> {
  const { data, error } = await supabase.from('conversation_state').select('*');
  if (error) throw new Error(`Supabase error (getConversationsForPolling): ${error.message}`);
  return (data ?? []) as ConversationState[];
}

export async function getKnownPaymentIds(paymentIds: string[]): Promise<Set<string>> {
  if (paymentIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('conversation_state')
    .select('payment_id')
    .in('payment_id', paymentIds);
  if (error) throw new Error(`Supabase error (getKnownPaymentIds): ${error.message}`);
  return new Set((data ?? []).map((r: { payment_id: string }) => r.payment_id));
}

// Widget-channel lookups: a customer is identified by customer_id (their
// Arena userId, which the Support Chat webhook carries) — no chat id to link.
export async function getAllConversationsByCustomerId(customerId: string): Promise<ConversationState[]> {
  const { data, error } = await supabase
    .from('conversation_state')
    .select('*')
    .eq('customer_id', customerId)
    .order('first_seen_at', { ascending: false });
  if (error) throw new Error(`Supabase error (getAllConversationsByCustomerId): ${error.message}`);
  return (data ?? []) as ConversationState[];
}

export async function getConversations(filters: {
  status?: ConversationStatus;
  category?: string;
} = {}): Promise<ConversationState[]> {
  let query = supabase.from('conversation_state').select('*');
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.category) query = query.eq('category', filters.category);
  query = query.order('updated_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw new Error(`Supabase error (getConversations): ${error.message}`);
  return (data ?? []) as ConversationState[];
}

export async function getConversationStatusCounts(): Promise<Record<ConversationStatus, number>> {
  const entries = await Promise.all(
    ALL_STATUSES.map(async (status) => {
      const { count, error } = await supabase
        .from('conversation_state')
        .select('*', { count: 'exact', head: true })
        .eq('status', status);
      if (error) throw new Error(`Supabase error (getConversationStatusCounts:${status}): ${error.message}`);
      return [status, count ?? 0] as const;
    })
  );
  return Object.fromEntries(entries) as Record<ConversationStatus, number>;
}

export async function getConversationById(conversationId: string): Promise<ConversationState | null> {
  const { data, error } = await supabase
    .from('conversation_state')
    .select('*')
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) {
    if (error.code === '22P02') return null;
    throw new Error(`Supabase error (getConversationById): ${error.message}`);
  }
  return (data as ConversationState) ?? null;
}

export async function createConversation(row: ConversationState): Promise<ConversationState> {
  const { data, error } = await supabase.from('conversation_state').insert(row).select().single();
  if (error) throw new Error(`Supabase error (createConversation): ${error.message}`);
  return data as ConversationState;
}

export async function updateConversation(
  conversationId: string,
  patch: Partial<ConversationState>
): Promise<void> {
  const { error } = await supabase.from('conversation_state').update(patch).eq('conversation_id', conversationId);
  if (error) throw new Error(`Supabase error (updateConversation): ${error.message}`);
}

export async function insertHistory(row: ConversationHistoryRow): Promise<void> {
  const { error } = await supabase.from('conversation_history').insert(row);
  if (error) throw new Error(`Supabase error (insertHistory): ${error.message}`);
}

export async function insertScenarioContext(row: ScenarioContextRow): Promise<void> {
  const { error } = await supabase.from('scenario_context').insert(row);
  if (error) throw new Error(`Supabase error (insertScenarioContext): ${error.message}`);
}

// True if a customer message with this Support Chat messageId was already stored. Used to ignore
// CrazyBet's at-least-once re-deliveries, including ones that arrive after a restart.
export async function hasSupportChatMessage(messageId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('id')
    .eq('metadata->>support_chat_message_id', messageId)
    .limit(1);
  if (error) throw new Error(`Supabase error (hasSupportChatMessage): ${error.message}`);
  return (data ?? []).length > 0;
}

export async function getHistoryForConversation(conversationId: string): Promise<ConversationHistoryRow[]> {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true });
  if (error) throw new Error(`Supabase error (getHistoryForConversation): ${error.message}`);
  return (data ?? []) as ConversationHistoryRow[];
}

export async function getScenarioContext(conversationId: string): Promise<ScenarioContextRow | null> {
  const { data, error } = await supabase
    .from('scenario_context')
    .select('*')
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) throw new Error(`Supabase error (getScenarioContext): ${error.message}`);
  return (data as ScenarioContextRow) ?? null;
}
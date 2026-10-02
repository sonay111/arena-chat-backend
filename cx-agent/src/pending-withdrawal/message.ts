// Step 1 of the pending-withdrawal flow: turn the three facts we need into
// the text the customer sees. Pure function -- no database, no network, no
// sending -- so it can be tested on its own. Sending is a later step.
//
// Only username, status and gateway are used (the three fields agreed as
// "all we need for now"). The gateway is optional on purpose: real
// withdrawal.initiated payloads have carried gateway: null, so the message
// must still read correctly when it isn't known yet.

export type PendingWithdrawalFacts = {
  username: string;
  status: string;
  gateway?: string | null;
};

export function buildPendingWithdrawalMessage(facts: PendingWithdrawalFacts): string {
  const gateway = facts.gateway?.trim();
  const via = gateway ? ` via ${gateway}` : "";

  return (
    `Hi ${facts.username}, we can see your withdrawal${via} is currently ${facts.status}. ` +
    `We're on it and will update you as soon as the status changes.`
  );
}

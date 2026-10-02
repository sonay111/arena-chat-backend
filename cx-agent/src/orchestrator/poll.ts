import { checkGatewayStatusChanges } from '../feed/serviceHealth';
import { runDispatchCycle } from '../dispatcher/dispatcher';
import { withdrawalSpecialist } from '../specialists/withdrawal';
import type { Specialist } from '../dispatcher/types';

// The specialists the agent runs. Adding a new kind of problem means adding one here.
export const specialists: Specialist<any>[] = [withdrawalSpecialist];

export async function runPollCycle(): Promise<void> {
  console.log(`Poll cycle running at ${new Date().toISOString()}`);

  // Payment gateway health check — logs status changes only, no messaging yet
  await checkGatewayStatusChanges();

  await runDispatchCycle(specialists);
}

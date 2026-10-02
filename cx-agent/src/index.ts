import { config } from './config';
import { createServer } from './server';
import { runPollCycle } from './orchestrator/poll';
import { startCatchUp } from './catchup/catchUp';

async function main(): Promise<void> {
  const app = createServer();
  app.listen(config.port, () => {
    console.log(`CX tool server listening on port ${config.port}`);
  });

  const intervalMs = config.pollIntervalSeconds * 1000;

  const tick = async () => {
    try {
      await runPollCycle();
    } catch (err) {
      console.error('Poll cycle failed', err);
    }
  };

  // Own timer, so a customer's message is still answered when the withdrawal poll cannot run.
  startCatchUp();

  await tick();
  setInterval(tick, intervalMs);
}

main().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
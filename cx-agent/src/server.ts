import express, { Express } from 'express';
import { supportChatInboundRouter } from './routes/supportChatInbound';
import { supportChatWebhookRouter } from './routes/supportChatWebhook';
import { humanRouter } from './routes/humanRoutes';
import { conversationRouter } from './routes/conversationRoutes';
import { getConversationStatusCounts } from './db/conversations';

export function createServer(): Express {
  const app = express();
  // The Support Chat webhook must come BEFORE express.json(): checking CrazyBet's signature
  // needs the exact raw bytes, which json parsing would consume.
  app.use('/support-chat', supportChatWebhookRouter);
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.get('/stats', async (_req, res) => {
    try {
      const stats = await getConversationStatusCounts();
      res.json({ ok: true, stats });
    } catch (err) {
      console.error('Error fetching stats', err);
      res.status(500).json({ error: 'internal error' });
    }
  });

  app.use('/support-chat', supportChatInboundRouter);
  app.use('/human', humanRouter);
  app.use('/conversations', conversationRouter);

  return app;
}

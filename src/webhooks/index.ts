import { Router } from "express";
import { rawBodyParser, logIncomingEnvelope } from "./envelope.js";
import { verifyWebhookSignature } from "./auth.js";
import { usersRouter } from "./users.js";
import { paymentsRouter } from "./payments.js";
import { betsRouter } from "./bets.js";
import { bonusesRouter } from "./bonuses.js";

export const webhooksRouter = Router();

// Order matters: raw bytes must be captured before anything reads the body
// (rawBodyParser), the raw event must be persisted before a signature
// check can reject it (logIncomingEnvelope), and only THEN do we decide
// whether to let the request continue to domain processing
// (verifyWebhookSignature). See envelope.ts / auth.ts for why.
webhooksRouter.use(rawBodyParser);
webhooksRouter.use(logIncomingEnvelope);
webhooksRouter.use(verifyWebhookSignature);
webhooksRouter.use(usersRouter);
webhooksRouter.use(paymentsRouter);
webhooksRouter.use(betsRouter);
webhooksRouter.use(bonusesRouter);

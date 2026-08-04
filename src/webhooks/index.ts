import { Router } from "express";
import { checkWebhookAuth } from "./auth.js";
import { usersRouter } from "./users.js";
import { paymentsRouter } from "./payments.js";
import { betsRouter } from "./bets.js";
import { bonusesRouter } from "./bonuses.js";

export const webhooksRouter = Router();

webhooksRouter.use(checkWebhookAuth);
webhooksRouter.use(usersRouter);
webhooksRouter.use(paymentsRouter);
webhooksRouter.use(betsRouter);
webhooksRouter.use(bonusesRouter);

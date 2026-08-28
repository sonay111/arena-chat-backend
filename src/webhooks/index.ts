import { Router } from "express";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { rawBodyParser, logIncomingEnvelope } from "./envelope.js";
import { verifyWebhookSignature } from "./auth.js";
import { usersRouter } from "./users.js";
import { paymentsRouter } from "./payments.js";
import { betsRouter } from "./bets.js";
import { bonusesRouter } from "./bonuses.js";

export const webhooksRouter = Router();

// The 8 real webhook routes this receiver handles, kept as an explicit
// list. rawBodyParser/logIncomingEnvelope/verifyWebhookSignature are
// scoped to only these paths — previously they were registered with no
// path at all, which in Express means "run for every request that reaches
// this router," not just these 8. Since webhooksRouter is mounted at the
// app root, that silently intercepted (and 401'd) completely unrelated
// routes too, e.g. /alerts/*, or even a typo'd URL with no matching route
// anywhere.
const WEBHOOK_PATHS = [
  "/users",
  "/deposits",
  "/deposits/status-update",
  "/withdrawals",
  "/withdrawals/status-update",
  "/sportsbook",
  "/casino",
  "/bonuses",
];

// A plain req.path check, NOT Express's own `.use(path, mw)` path-matching —
// that form rewrites req.url/req.path to strip the matched prefix for the
// duration of the middleware (mount-point semantics), which broke
// logIncomingEnvelope's `req.path === "/users"` special case and made it
// log every route as "/" instead of the real path. This wrapper runs the
// real middleware with req completely untouched, only gating whether it
// runs at all.
function onlyForWebhookPaths(middleware: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (WEBHOOK_PATHS.includes(req.path)) {
      return middleware(req, res, next);
    }
    next();
  };
}

// Order matters: raw bytes must be captured before anything reads the body
// (rawBodyParser), the raw event must be persisted before a signature
// check can reject it (logIncomingEnvelope), and only THEN do we decide
// whether to let the request continue to domain processing
// (verifyWebhookSignature). See envelope.ts / auth.ts for why.
webhooksRouter.use(onlyForWebhookPaths(rawBodyParser));
webhooksRouter.use(onlyForWebhookPaths(logIncomingEnvelope));
webhooksRouter.use(onlyForWebhookPaths(verifyWebhookSignature));
webhooksRouter.use(usersRouter);
webhooksRouter.use(paymentsRouter);
webhooksRouter.use(betsRouter);
webhooksRouter.use(bonusesRouter);

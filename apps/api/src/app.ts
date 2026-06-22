import cookieParser from "cookie-parser";
import cors from "cors";
import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import helmet from "helmet";
import { ZodError } from "zod";
import { passport } from "./auth/google.js";
import { config, isAllowedWebOrigin } from "./config.js";
import { AppError } from "./lib/errors.js";
import { requestContext } from "./middleware/request-context.js";
import { sanitizeBody } from "./middleware/sanitize.js";
import {
  enforceHttps,
  enforceTrustedOrigin,
  globalRateLimit,
} from "./middleware/security.js";
import { createStaticWebMiddleware } from "./middleware/static-web.js";
import { authRouter } from "./routes/auth.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { botRouter } from "./routes/bot.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import { homeRouter } from "./routes/home.routes.js";
import { leaderboardRouter } from "./routes/leaderboard.routes.js";
import { notificationRouter } from "./routes/notification.routes.js";
import { gameRouter } from "./routes/game.routes.js";
import { profileRouter } from "./routes/profile.routes.js";
import { realtimeRouter } from "./routes/realtime.routes.js";
import { tournamentRouter } from "./routes/tournament.routes.js";
import { walletRouter } from "./routes/wallet.routes.js";
import { supportRouter } from "./routes/support.routes.js";
import { tradeJitoRouter } from "./routes/trade-jito.routes.js";
import { webhookRouter } from "./routes/webhook.routes.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", config.TRUST_PROXY);
  app.disable("x-powered-by");

  app.use(enforceHttps);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, isAllowedWebOrigin(origin));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    }),
  );
  app.use(globalRateLimit);
  app.use("/api/webhook", webhookRouter);
  app.use(enforceTrustedOrigin);
  app.use(express.json({ limit: "32kb" }));
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));
  app.use(cookieParser());
  app.use(requestContext);
  app.use(sanitizeBody);
  app.use(passport.initialize());

  app.use("/api", healthRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/bots", botRouter);
  app.use("/api/home", homeRouter);
  app.use("/api/leaderboard", leaderboardRouter);
  app.use("/api/notifications", notificationRouter);
  app.use("/api/games", gameRouter);
  app.use("/api/profile", profileRouter);
  app.use("/api/realtime", realtimeRouter);
  app.use("/api/wallet", walletRouter);
  app.use("/api/tournaments", tournamentRouter);
  app.use("/api/trade-jito", tradeJitoRouter);
  app.use("/api/support", supportRouter);

  for (const handler of createStaticWebMiddleware()) {
    app.use(handler);
  }

  const notFound: RequestHandler = (_request, _response, next) => {
    next(new AppError(404, "NOT_FOUND", "এই API route পাওয়া যায়নি।"));
  };
  app.use(notFound);

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    if (error instanceof ZodError) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "দেওয়া তথ্য সঠিক নয়।",
          details: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
      return;
    }

    if (error instanceof AppError) {
      response.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
      return;
    }

    console.error(error);
    response.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "সার্ভারে সমস্যা হয়েছে। একটু পরে আবার চেষ্টা করুন।",
      },
    });
  };
  app.use(errorHandler);

  return app;
}

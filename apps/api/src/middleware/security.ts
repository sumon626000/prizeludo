import type { Request, RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { config, isAllowedWebOrigin, isProduction } from "../config.js";
import { AppError } from "../lib/errors.js";

const skipInTest = () => config.NODE_ENV === "test";

function isApacheInternalHop(request: Request) {
  const remote = request.socket.remoteAddress ?? "";
  return (
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote === "::ffff:127.0.0.1" ||
    remote.endsWith("127.0.0.1")
  );
}

function requestIsSecure(request: Request) {
  if (request.secure) return true;

  const forwardedProto = request
    .header("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProto === "https") return true;

  if (isProduction) {
    // Apache/Webuzo terminates TLS and proxies to Node on localhost without proto header.
    if (isApacheInternalHop(request)) return true;
  }

  return false;
}

export const enforceHttps: RequestHandler = (request, response, next) => {
  if (isProduction && !requestIsSecure(request)) {
    const target = new URL(config.API_PUBLIC_URL);
    const requestUrl = new URL(request.originalUrl, "http://internal.invalid");
    target.pathname = requestUrl.pathname;
    target.search = requestUrl.search;
    target.hash = "";
    return response.redirect(308, target.toString());
  }
  next();
};

export const enforceTrustedOrigin: RequestHandler = (request, _response, next) => {
  if (
    request.path.startsWith("/api/webhook") ||
    request.path.endsWith("/webhook")
  ) {
    next();
    return;
  }
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    next();
    return;
  }
  const origin = request.header("origin");
  const fetchSite = request.header("sec-fetch-site");
  if ((origin && !isAllowedWebOrigin(origin)) || fetchSite === "cross-site") {
    next(new AppError(403, "UNTRUSTED_ORIGIN", "Request origin is not allowed."));
    return;
  }
  next();
};

export const globalRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 180,
  skip: skipInTest,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "অনেক বেশি অনুরোধ হয়েছে। একটু পরে আবার চেষ্টা করুন।",
    },
  },
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  skip: skipInTest,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: {
      code: "AUTH_RATE_LIMITED",
      message: "অনেকবার চেষ্টা করা হয়েছে। ১৫ মিনিট পরে আবার চেষ্টা করুন।",
    },
  },
});

export const walletRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  skip: skipInTest,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: {
      code: "WALLET_RATE_LIMITED",
      message: "অনেক বেশি wallet request হয়েছে। একটু পরে আবার চেষ্টা করুন।",
    },
  },
});

export const gameRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 180,
  skip: skipInTest,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: {
      code: "GAME_RATE_LIMITED",
      message: "Too many game actions. Please wait a moment.",
    },
  },
});

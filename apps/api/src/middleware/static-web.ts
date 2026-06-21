import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { type RequestHandler } from "express";
import { config, isProduction } from "../config.js";

const blockedPathPattern =
  /(^|\/)\.(env|git)(\/|$)|(^|\/)(node_modules|apps|src|docs|scripts|drizzle)(\/|$)/;

export function isSingleDomainDeploy(): boolean {
  if (!isProduction) return false;
  try {
    const web = new URL(config.WEB_ORIGIN);
    const api = new URL(config.API_PUBLIC_URL);
    return web.hostname === api.hostname;
  } catch {
    return false;
  }
}

export function createStaticWebMiddleware(): RequestHandler[] {
  if (!isSingleDomainDeploy()) return [];

  const root = config.WEB_ROOT;
  const indexPath = join(root, "index.html");
  if (!existsSync(indexPath)) {
    console.warn(
      `[static-web] WEB_ROOT missing index.html (${root}) — homepage will 404 until web is deployed`,
    );
    return [];
  }

  console.info(`[static-web] Serving SPA from ${root}`);

  const blockSensitivePaths: RequestHandler = (request, response, next) => {
    if (blockedPathPattern.test(request.path)) {
      response.status(404).end();
      return;
    }
    next();
  };

  const staticHandler = express.static(root, {
    index: false,
    maxAge: "1d",
    fallthrough: true,
  });

  const spaFallback: RequestHandler = (request, response, next) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      next();
      return;
    }
    if (request.path.startsWith("/api/")) {
      next();
      return;
    }
    response.sendFile(indexPath, (error) => {
      if (error) next(error);
    });
  };

  return [blockSensitivePaths, staticHandler, spaFallback];
}

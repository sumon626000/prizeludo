import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express, { Router } from "express";
import { config } from "../config.js";
import { asyncHandler } from "../lib/async-handler.js";
import { AppError } from "../lib/errors.js";

const router = Router();

function verifyGitHubSignature(
  payload: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const actual = signatureHeader.slice("sha256=".length);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function resolveDeployScript(): string {
  const candidates = [
    config.DEPLOY_SCRIPT,
    resolve(process.cwd(), "scripts/update-changed.sh"),
    resolve(process.cwd(), "../../scripts/update-changed.sh"),
    resolve(process.cwd(), "scripts/deploy-webuzo.sh"),
    "/home/nixbazar/prizejito.com/scripts/update-changed.sh",
    "/home/nixbazar/prizejito.com/scripts/deploy-webuzo.sh",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new AppError(
    500,
    "DEPLOY_SCRIPT_MISSING",
    "Deploy script not found on server.",
  );
}

function triggerDeploy(): void {
  const scriptPath = resolveDeployScript();
  const child = spawn("bash", [scriptPath], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      DEPLOY_REPO_PATH: config.DEPLOY_REPO_PATH,
      WEB_ROOT: config.WEB_ROOT,
      DEPLOY_BRANCH: config.DEPLOY_BRANCH,
      PUBLIC_API_URL: config.API_PUBLIC_URL,
      PUBLIC_WEB_ORIGIN: config.WEB_ORIGIN,
      NODE_PORT: String(config.PORT),
    },
  });
  child.unref();
}

router.post(
  "/git-update",
  express.raw({ type: "application/json", limit: "256kb" }),
  asyncHandler(async (request, response) => {
    if (!config.GITHUB_WEBHOOK_SECRET) {
      throw new AppError(
        503,
        "WEBHOOK_NOT_CONFIGURED",
        "GitHub webhook secret is not configured on the server.",
      );
    }

    const payload = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from(JSON.stringify(request.body ?? {}));

    if (
      !verifyGitHubSignature(
        payload,
        request.header("x-hub-signature-256"),
        config.GITHUB_WEBHOOK_SECRET,
      )
    ) {
      throw new AppError(401, "INVALID_WEBHOOK", "Invalid GitHub webhook signature.");
    }

    const event = request.header("x-github-event") ?? "unknown";
    if (event === "ping") {
      response.json({ ok: true, message: "pong" });
      return;
    }

    if (event !== "push") {
      response.status(202).json({ ok: true, ignored: true, event });
      return;
    }

    const body = JSON.parse(payload.toString()) as {
      ref?: string;
      repository?: { full_name?: string };
    };

    if (body.ref !== `refs/heads/${config.DEPLOY_BRANCH}`) {
      response.status(202).json({
        ok: true,
        ignored: true,
        reason: "non_target_branch",
        ref: body.ref ?? null,
      });
      return;
    }

    triggerDeploy();
    response.status(202).json({
      ok: true,
      queued: true,
      repository: body.repository?.full_name ?? null,
      ref: body.ref ?? null,
    });
  }),
);

export { router as webhookRouter };

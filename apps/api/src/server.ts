import express from "express";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "@deepvue/db";
import { validateAllPolicies } from "@deepvue/core";
import { config, logger } from "@deepvue/platform";
import { routePath } from "./middleware/auth";
import { corsMiddleware } from "./middleware/cors";
import { requestContextMiddleware } from "./middleware/request-context";
import { v1 } from "./routes";

export const app = express();

app.disable("x-powered-by");
app.use(corsMiddleware.handle());
app.use(requestContextMiddleware.handle());
app.use("/v1", v1);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "not_found" });
});

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, method: req.method, path: routePath(req) }, "http.unhandled_error");
  if (res.headersSent) return;
  res.status(500).json({ error: "internal_error" });
});

try {
  const policies = validateAllPolicies();
  logger.info(
    { count: policies.length, policies: policies.map((p) => `${p.customer}@${p.version}`) },
    "policies.validated",
  );
} catch (err) {
  logger.error({ err }, "policies.invalid");
  throw err;
}

const port = config.getIntSync("PORT", 3000);

const server = app.listen(port, () => {
  logger.info({ port, cors_origins: config.getSync("CORS_ORIGINS") ?? null }, "api.listening");
});
server.headersTimeout = 65_000;
server.requestTimeout = 0;

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "api.shutting_down");
  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  } catch (err) {
    logger.error({ err }, "api.shutdown_error");
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("unhandledRejection", (err) => {
  logger.error({ err }, "api.unhandled_rejection");
});

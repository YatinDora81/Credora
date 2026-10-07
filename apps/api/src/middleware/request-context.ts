import type { NextFunction, Request, RequestHandler, Response } from "express";
import { logger, newRequestId, withContext } from "@credora/platform";
import { routePath } from "./auth";

const QUIET_PATHS = new Set(["/v1/health", "/v1/keepalive"]);

export class RequestContextMiddleware {
  handle = (): RequestHandler => (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.header("X-Request-Id")?.trim() || newRequestId();
    res.setHeader("X-Request-Id", requestId);

    const started = Date.now();
    const path = routePath(req);
    res.on("finish", () => {
      withContext({ request_id: requestId }, () => {
        const line = {
          method: req.method,
          path,
          status: res.statusCode,
          duration_ms: Date.now() - started,
        };
        if (QUIET_PATHS.has(path)) logger.debug(line, "http.request");
        else logger.info(line, "http.request");
      });
    });

    withContext({ request_id: requestId }, () => next());
  };
}

export const requestContextMiddleware = new RequestContextMiddleware();

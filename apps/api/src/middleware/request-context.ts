import type { NextFunction, Request, RequestHandler, Response } from "express";
import { logger, newRequestId, withContext } from "@deepvue/platform";
import { routePath } from "./auth";

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
        if (path === "/v1/health") logger.debug(line, "http.request");
        else logger.info(line, "http.request");
      });
    });

    withContext({ request_id: requestId }, () => next());
  };
}

export const requestContextMiddleware = new RequestContextMiddleware();

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { config, logger } from "@credora/platform";
import { routePath } from "./auth";

function secureEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class AdminAuthMiddleware {
  guard = (): RequestHandler => async (req: Request, res: Response, next: NextFunction) => {
    const expected = await config.get("ADMIN_KEY");
    const provided = req.header("X-Admin-Key");
    if (!expected || !provided || !secureEquals(provided, expected)) {
      logger.warn({ path: routePath(req) }, "admin.forbidden");
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}

export const adminAuthMiddleware = new AdminAuthMiddleware();

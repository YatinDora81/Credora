import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Customer } from "@deepvue/db";
import { customerRepository } from "@deepvue/db";
import { logger } from "@deepvue/platform";

declare global {
  namespace Express {
    interface Request {
      customer?: Customer;
    }
  }
}

const PUBLIC_PATHS = new Set(["/v1/health", "/v1/keepalive"]);
const PUBLIC_PREFIXES = ["/v1/admin"];

function isPublic(path: string): boolean {
  const clean = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (PUBLIC_PATHS.has(clean)) return true;
  return PUBLIC_PREFIXES.some((p) => clean === p || clean.startsWith(p + "/"));
}

export function routePath(req: Request): string {
  const raw = req.originalUrl || req.url || "";
  const q = raw.indexOf("?");
  return q >= 0 ? raw.slice(0, q) : raw;
}

function fingerprint(key: string): string {
  return new Bun.CryptoHasher("sha256").update(key).digest("hex").slice(0, 8);
}

export class AuthMiddleware {
  apiKey = (): RequestHandler => async (req: Request, res: Response, next: NextFunction) => {
    const path = routePath(req);
    if (isPublic(path)) return next();

    const apiKey = req.header("X-API-Key");
    if (!apiKey || apiKey.trim() === "") {
      logger.warn({ path }, "auth.missing_api_key");
      res.status(401).json({ error: "missing_api_key" });
      return;
    }

    const customer = await customerRepository.findByApiKey(apiKey);
    if (!customer) {
      logger.warn({ path, key_fp: fingerprint(apiKey) }, "auth.invalid_api_key");
      res.status(401).json({ error: "invalid_api_key" });
      return;
    }

    req.customer = customer;
    next();
  };

  customerOf = (req: Request): Customer => {
    const customer = req.customer;
    if (!customer) throw new Error("customerOf() called on an unauthenticated route");
    return customer;
  };
}

export const authMiddleware = new AuthMiddleware();

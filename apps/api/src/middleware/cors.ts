import type { NextFunction, Request, RequestHandler, Response } from "express";
import { config } from "@deepvue/platform";

const ALLOWED_HEADERS = "Content-Type, Accept, X-API-Key, X-Admin-Key, Idempotency-Key, X-Request-Id";
const ALLOWED_METHODS = "GET, POST, PUT, OPTIONS";
const EXPOSED_HEADERS = "X-Request-Id";
const PREFLIGHT_MAX_AGE_SEC = "600";

// CORS_ORIGINS is a comma-separated list. Entries are exact origins
// ("https://deepvue.vercel.app"), subdomain wildcards ("https://*.vercel.app"), or "*".
function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function matches(origin: string, pattern: string): boolean {
  if (pattern === "*" || pattern === origin) return true;
  const star = pattern.indexOf("://*.");
  if (star < 0) return false;
  const scheme = pattern.slice(0, star + 3);
  const suffix = pattern.slice(star + 4);
  return origin.startsWith(scheme) && origin.endsWith(suffix) && origin.length > scheme.length + suffix.length;
}

export class CorsMiddleware {
  handle = (): RequestHandler => {
    const allowed = parseOrigins(config.getSync("CORS_ORIGINS"));

    return (req: Request, res: Response, next: NextFunction) => {
      const origin = req.header("Origin");
      if (origin && allowed.some((p) => matches(origin, p))) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Expose-Headers", EXPOSED_HEADERS);
        res.append("Vary", "Origin");
      }

      if (req.method === "OPTIONS" && req.header("Access-Control-Request-Method")) {
        res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
        res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
        res.setHeader("Access-Control-Max-Age", PREFLIGHT_MAX_AGE_SEC);
        res.status(204).end();
        return;
      }

      next();
    };
  };
}

export const corsMiddleware = new CorsMiddleware();

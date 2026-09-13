import pino from "pino";
import type { DestinationStream, LogFn, Logger, LoggerOptions } from "pino";
import { als } from "./context";

export function maskPan(v: string)   { return v.slice(0, 3) + "****" + v.slice(-1); }
export function maskGstin(v: string) { return v.slice(0, 2) + "****" + v.slice(-4); }

const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d?[A-Z\d]Z[A-Z\d]\b/g;
const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;

export function maskText(value: string): string {
  if (value.length < 10) return value;
  return value.replace(GSTIN_PATTERN, maskGstin).replace(PAN_PATTERN, maskPan);
}

export function errorText(err: unknown): string {
  if (err === null || err === undefined) return "";
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? ` (cause: ${cause.name}: ${cause.message})` : "";
    return `${err.name}: ${err.message}${causeText}`;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

export function maskedError(err: unknown, max = 500): string {
  return maskText(errorText(err)).slice(0, max);
}

const MAX_DEPTH = 12;
const MAX_ARRAY = 500;

function maskError(err: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: err.name,
    name: err.name,
    message: typeof err.message === "string" ? maskText(err.message) : err.message,
  };
  if (typeof err.stack === "string") out.stack = maskText(err.stack);
  for (const key of Object.keys(err)) {
    if (key === "name" || key === "message" || key === "stack") continue;
    if (key === "type") continue;
    out[key] = maskDeep((err as unknown as Record<string, unknown>)[key], depth + 1, seen);
  }
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined && out.cause === undefined) {
    out.cause = maskDeep(cause, depth + 1, seen);
  }
  return out;
}

function maskDeep(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "string") return maskText(value);
  if (value === null || typeof value !== "object") {
    return typeof value === "function" ? "[Function]" : value;
  }

  if (seen.has(value as object)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated: max depth]";
  seen.add(value as object);

  try {
    if (Array.isArray(value)) {
      const limited = value.length > MAX_ARRAY ? value.slice(0, MAX_ARRAY) : value;
      const out: unknown[] = limited.map((item) => maskDeep(item, depth + 1, seen));
      if (value.length > MAX_ARRAY) out.push(`[Truncated: ${value.length - MAX_ARRAY} more]`);
      return out;
    }
    if (value instanceof Error) return maskError(value, depth, seen);
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Map) {
      return maskDeep(Object.fromEntries(value.entries()), depth, seen);
    }
    if (value instanceof Set) return maskDeep([...value], depth, seen);

    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = maskDeep((value as Record<string, unknown>)[key], depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value as object);
  }
}

const REDACT = {
  paths: [
    "pan", "gstin",
    "*.pan", "*.gstin",
    "business.pan", "business.gstin",
    "payload.business.pan", "payload.business.gstin",
    "req.body.business.pan", "req.body.business.gstin",
    "req.headers['x-api-key']",
    "req.headers.authorization",
  ],
  censor: "[REDACTED]",
};

function baseOptions(): LoggerOptions {
  return {
    level: process.env.LOG_LEVEL ?? "info",
    redact: REDACT,

    mixin() {
      const store = als.getStore();
      return store ? { ...store } : {};
    },

    formatters: {
      log(obj: Record<string, unknown>): Record<string, unknown> {
        return maskDeep(obj) as Record<string, unknown>;
      },
    },

    hooks: {
      logMethod(this: Logger, args: [msg: string, ...rest: unknown[]], method: LogFn) {
        for (let i = 0; i < args.length; i++) {
          const arg = args[i];
          if (typeof arg === "string") args[i] = maskText(arg);
        }
        return method.apply(this, args as Parameters<LogFn>);
      },
    },
  };
}

export function makeLogger(destination?: DestinationStream): Logger {
  return destination ? pino(baseOptions(), destination) : pino(baseOptions());
}

export const logger: Logger = makeLogger();

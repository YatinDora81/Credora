import { createHash } from "node:crypto";
import type { Evidence } from "../types";
import type { Policy } from "./types";

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value instanceof Date) return value.toISOString();
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    out[key] = canonicalise(source[key]);
  }
  return out;
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function evidenceHash(evidence: Evidence): string {
  return "sha256:" + sha256Hex(canonicalStringify(evidence));
}

export function policyHash(policy: Policy): string {
  return "sha256:" + sha256Hex(canonicalStringify(policy));
}

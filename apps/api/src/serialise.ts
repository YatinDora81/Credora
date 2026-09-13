import type { Application, ApplicationStatus, UpstreamCall } from "@deepvue/db";
import type { ClauseResult, Concern, Policy } from "@deepvue/core";

export type ApiStatus = "PROCESSING" | "APPROVED" | "REVIEW" | "REJECTED" | "FAILED";

const TERMINAL: ReadonlySet<string> = new Set(["APPROVED", "REVIEW", "REJECTED", "FAILED"]);

function apiStatus(status: ApplicationStatus | string): ApiStatus {
  return status === "PENDING" ? "PROCESSING" : (status as ApiStatus);
}

function isTerminal(status: ApplicationStatus | string): boolean {
  return TERMINAL.has(status);
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export interface StoredDecisionView {
  degraded_reasons: string[];
  reasons: ClauseResult[];
  evidence_hash: string | null;
  policy_hash: string | null;
  decided_at: string | null;
  degraded: boolean | null;
  concerns: Concern[];
}

function readDecision(decision: unknown): StoredDecisionView {
  const d = asObject(decision);
  return {
    degraded_reasons: asArray<string>(d?.degraded_reasons),
    reasons: asArray<ClauseResult>(d?.clause_results ?? d?.reasons),
    evidence_hash: asString(d?.evidence_hash),
    policy_hash: asString(d?.policy_hash),
    decided_at: asString(d?.decided_at),
    degraded: typeof d?.degraded === "boolean" ? (d.degraded as boolean) : null,
    concerns: asArray<Concern>(d?.concerns),
  };
}

export interface ExtractionView {
  available: boolean;
  reason: string | null;
  fields: unknown[];
  ungrounded: unknown[];
  concerns: Concern[];
  model: string | null;
  cached: boolean;
}

function mergeConcerns(...lists: Concern[][]): Concern[] {
  const seen = new Set<string>();
  const out: Concern[] = [];
  for (const list of lists) {
    for (const c of list) {
      if (!c || typeof c !== "object") continue;
      const key = `${c.code}\u0000${c.quote ?? ""}\u0000${c.detail ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

function readExtraction(extraction: unknown, fallbackConcerns: Concern[] = []): ExtractionView {
  const e = asObject(extraction);
  return {
    available: e?.available === true,
    reason: asString(e?.reason),
    fields: asArray<unknown>(e?.fields),
    ungrounded: asArray<unknown>(e?.ungrounded),
    concerns: mergeConcerns(fallbackConcerns, asArray<Concern>(e?.concerns)),
    model: asString(e?.model),
    cached: e?.cached === true,
  };
}

export function serialiseAccepted(application: {
  id: string;
  status: ApplicationStatus | string;
}): { application_id: string; status: ApiStatus } {
  return { application_id: application.id, status: apiStatus(application.status) };
}

export function serialiseInFlight(application: Application): {
  application_id: string;
  status: ApiStatus;
  created_at: string | null;
} {
  return {
    application_id: application.id,
    status: apiStatus(application.status),
    created_at: iso(application.createdAt),
  };
}

function serialiseUpstreamCall(call: UpstreamCall): Record<string, unknown> {
  const out: Record<string, unknown> = {
    attempt: call.attempt,
    started_at: iso(call.startedAt),
    duration_ms: call.durationMs,
    outcome: call.outcome,
  };
  if (call.statusCode !== null && call.statusCode !== undefined) out.status_code = call.statusCode;
  if (call.retryAfterSec !== null && call.retryAfterSec !== undefined) {
    out.retry_after_sec = call.retryAfterSec;
  }
  if (call.error) out.error = call.error;
  return out;
}

export interface FullOptions {
  activeVersionNow: string | null;
  resolvedPolicy: Policy | null;
  upstreamCalls: UpstreamCall[];
}

export function serialiseFull(application: Application, opts: FullOptions): Record<string, unknown> {
  const decision = readDecision(application.decision);
  const extraction = readExtraction(application.extraction, decision.concerns);

  return {
    application_id: application.id,
    application_id_external: application.externalId ?? null,
    status: apiStatus(application.status),
    created_at: iso(application.createdAt),
    decided_at: decision.decided_at ?? (isTerminal(application.status) ? iso(application.updatedAt) : null),
    degraded: application.degraded || decision.degraded === true,
    degraded_reasons: decision.degraded_reasons,
    policy: {
      customer: application.policyCustomerKey,
      version: application.policyVersion,
      active_version_now: opts.activeVersionNow,
      resolved: opts.resolvedPolicy,
    },
    reasons: decision.reasons,
    upstream_calls: opts.upstreamCalls.map(serialiseUpstreamCall),
    extraction: {
      available: extraction.available,
      reason: extraction.reason,
      model: extraction.model,
      cached: extraction.cached,
      fields: extraction.fields,
      ungrounded: extraction.ungrounded,
      concerns: extraction.concerns,
    },
    evidence_hash: decision.evidence_hash,
    policy_hash: decision.policy_hash,
  };
}

export function serialiseListItem(application: Application): Record<string, unknown> {
  const decision = readDecision(application.decision);
  return {
    application_id: application.id,
    application_id_external: application.externalId ?? null,
    status: apiStatus(application.status),
    degraded: application.degraded || decision.degraded === true,
    policy: { version: application.policyVersion },
    created_at: iso(application.createdAt),
    decided_at: decision.decided_at ?? (isTerminal(application.status) ? iso(application.updatedAt) : null),
  };
}

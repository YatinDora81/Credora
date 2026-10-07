import { Prisma } from "@credora/db";
import type { Application } from "@credora/db";
import { applicationRepository } from "@credora/db";
import {
  aggregate,
  buildEvidence,
  evaluate,
  evidenceHash,
  loadPolicy,
  policyHash,
} from "@credora/core";
import type {
  ApplicationPayload,
  ClauseResult,
  Concern,
  Evidence,
  ExtractionEnvelope,
  UpstreamResult,
} from "@credora/core";
import { config, logger, maskedError, newRequestId, withContext } from "@credora/platform";
import { upstreamService } from "./upstream.service";
import { extractionService } from "./extraction.service";

const DEFAULT_DEADLINE_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;

export interface PersistedDecision {
  outcome: "APPROVED" | "REVIEW" | "REJECTED";
  degraded: boolean;
  degraded_reasons: string[];
  clause_results: ClauseResult[];
  policy: { customer: string; version: string };
  evidence_hash: string;
  policy_hash: string;
  concerns: Concern[];
  decided_at: string;
}

export interface PipelineOutcome {
  status: "APPROVED" | "REVIEW" | "REJECTED" | "FAILED";
  decision: PersistedDecision | null;
}

function appliedOnIso(payload: ApplicationPayload | null, row: Application): string {
  const fromPayload = payload?.applied_on;
  if (typeof fromPayload === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fromPayload.trim())) {
    return fromPayload.trim();
  }
  const d = row.appliedOn instanceof Date ? row.appliedOn : new Date(row.appliedOn);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

const UNAVAILABLE_EXTRACTION: ExtractionEnvelope = {
  available: false,
  reason: "MODEL_UNAVAILABLE",
  extraction: null,
  fields: [],
  ungrounded: [],
  concerns: [],
  model: null,
  cached: false,
};

export class PipelineService {
  process = async (row: Application): Promise<PipelineOutcome> =>
    withContext({ request_id: newRequestId(), application_id: row.id }, () => this.run(row));

  private run = async (row: Application): Promise<PipelineOutcome> => {
    const startedAt = Date.now();

    try {
      const maxAttempts = await config.getPositiveInt(
        "WORKER_MAX_ATTEMPTS",
        DEFAULT_MAX_ATTEMPTS,
      );
      if (row.attempts > maxAttempts) {
        const error = `attempts (${row.attempts}) exceeded WORKER_MAX_ATTEMPTS (${maxAttempts})`;
        await this.markFailed(row.id);
        logger.error({
          event: "application.failed",
          application_id: row.id,
          error,
          attempts: row.attempts,
        });
        return { status: "FAILED", decision: null };
      }

      const payload = (row.payload ?? null) as ApplicationPayload | null;
      if (!payload || typeof payload !== "object" || !payload.business || !payload.loan) {
        throw new Error("application payload is missing or malformed");
      }

      const budgetMs = Math.max(
        1,
        await config.getPositiveInt("APPLICATION_DEADLINE_MS", DEFAULT_DEADLINE_MS),
      );

      let upstream: UpstreamResult | null = null;
      let upstreamSettled = false;
      let extraction: ExtractionEnvelope | null = null;

      const upstreamTask = upstreamService
        .verifyBusiness(String(payload.business.gstin ?? ""), appliedOnIso(payload, row), row.id)
        .then(
          (result) => {
            upstream = result;
            upstreamSettled = true;
          },
          (err) => {
            upstreamSettled = true;
            logger.error({
              event: "upstream.client_error",
              application_id: row.id,
              error: maskedError(err, 1000),
            });
          },
        );

      const extractionTask = extractionService
        .extract(
          payload.unstructured?.field_agent_note ?? "",
          payload.unstructured?.document_text ?? "",
          row.id,
        )
        .then(
          (e) => {
            extraction = e;
          },
          (err) => {
            logger.error({
              event: "extraction.client_error",
              application_id: row.id,
              error: maskedError(err, 1000),
            });
            extraction = UNAVAILABLE_EXTRACTION;
          },
        );

      let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
      const deadlineFired = new Promise<"DEADLINE">((resolve) => {
        deadlineTimer = setTimeout(() => resolve("DEADLINE"), budgetMs);
        (deadlineTimer as unknown as { unref?: () => void }).unref?.();
      });

      const both = Promise.allSettled([upstreamTask, extractionTask]).then(() => "SETTLED" as const);
      const winner = await Promise.race([both, deadlineFired]);
      if (deadlineTimer !== null) clearTimeout(deadlineTimer);

      const deadlineExceeded = winner === "DEADLINE";
      if (deadlineExceeded) {
        logger.warn({
          event: "application.deadline_exceeded",
          application_id: row.id,
          deadline_ms: budgetMs,
          upstream_settled: upstreamSettled,
          extraction_settled: extraction !== null,
        });
      }

      const { evidence, concerns } = buildEvidence({
        payload,
        upstream: upstream as UpstreamResult | null,
        extraction: extraction as ExtractionEnvelope | null,
      });

      const policy = loadPolicy(row.policyCustomerKey, row.policyVersion);
      const results = evaluate(evidence as Evidence, policy);
      const summary = aggregate(results, policy);

      logger.info({
        event: "policy.evaluated",
        application_id: row.id,
        policy_version: policy.version,
        policy_customer: policy.customer,
        pass: results.filter((r) => r.result === "PASS").length,
        fail: results.filter((r) => r.result === "FAIL").length,
        undetermined: results.filter((r) => r.result === "UNDETERMINED").length,
        not_applicable: results.filter((r) => r.result === "NOT_APPLICABLE").length,
      });

      const decision: PersistedDecision = {
        outcome: summary.outcome,
        degraded: summary.degraded,
        degraded_reasons: summary.degraded_reasons,
        clause_results: results,
        policy: { customer: policy.customer, version: policy.version },
        evidence_hash: evidenceHash(evidence),
        policy_hash: policyHash(policy),
        concerns,
        decided_at: new Date().toISOString(),
      };

      await applicationRepository.saveDecision(row.id, {
        status: summary.outcome,
        evidence: toJson(evidence),
        extraction: extraction === null ? Prisma.JsonNull : toJson(extraction),
        decision: toJson(decision),
        degraded: summary.degraded,
      });

      logger.info({
        event: "decision.completed",
        application_id: row.id,
        outcome: summary.outcome,
        degraded: summary.degraded,
        duration_ms: Date.now() - startedAt,
        pass: results.filter((r) => r.result === "PASS").length,
        fail: results.filter((r) => r.result === "FAIL").length,
        undetermined: results.filter((r) => r.result === "UNDETERMINED").length,
        concerns: concerns.length,
        deadline_exceeded: deadlineExceeded,
      });

      return { status: summary.outcome, decision };
    } catch (err) {
      logger.error({
        event: "application.failed",
        application_id: row.id,
        error: maskedError(err, 1000),
        duration_ms: Date.now() - startedAt,
      });
      await this.markFailed(row.id);
      return { status: "FAILED", decision: null };
    }
  };

  private markFailed = async (applicationId: string): Promise<void> => {
    try {
      await applicationRepository.markFailed(applicationId);
    } catch (err) {
      logger.error({
        event: "application.mark_failed_error",
        application_id: applicationId,
        error: maskedError(err),
      });
    }
  };
}

export const pipelineService = new PipelineService();

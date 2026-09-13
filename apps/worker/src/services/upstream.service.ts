import { upstreamCallRepository } from "@deepvue/db";
import type { UpstreamCallOutcome, UpstreamCallRecord, UpstreamResult } from "@deepvue/core";
import { config, errorText, logger, maskText, maskedError } from "@deepvue/platform";
import { breakerService } from "./breaker.service";

const DEFAULTS = {
  UPSTREAM_BASE_URL: "http://mock-upstream:4000",
  UPSTREAM_TIMEOUT_MS: 4000,
  UPSTREAM_MAX_ATTEMPTS: 3,
  UPSTREAM_BACKOFF_BASE_MS: 500,
  UPSTREAM_TOTAL_BUDGET_MS: 20_000,
} as const;

const MAX_RETRY_AFTER_SEC = 10;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface AttemptResult {
  outcome: UpstreamCallOutcome;
  statusCode: number | null;
  retryAfterSec: number | null;
  error: string | null;
  result: UpstreamResult | null;
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? "";
  if (name === "TimeoutError" || name === "AbortError") return true;
  const message = String((err as { message?: string } | null)?.message ?? "").toLowerCase();
  return (
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("the operation was aborted")
  );
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.trunc(seconds);
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return null;
}

function isUpstreamResult(body: unknown): body is UpstreamResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  return typeof b.gstin === "string" && typeof b.status === "string" && b.status !== "";
}

export class UpstreamService {
  verifyBusiness = async (
    gstin: string,
    appliedOn: string,
    applicationId: string,
  ): Promise<UpstreamResult | null> => {
    const [root, timeoutMs, maxAttempts, backoffBaseMs, totalBudgetMs] = await Promise.all([
      this.baseUrl(),
      config.getPositiveInt("UPSTREAM_TIMEOUT_MS", DEFAULTS.UPSTREAM_TIMEOUT_MS),
      config.getPositiveInt("UPSTREAM_MAX_ATTEMPTS", DEFAULTS.UPSTREAM_MAX_ATTEMPTS),
      config.getPositiveInt("UPSTREAM_BACKOFF_BASE_MS", DEFAULTS.UPSTREAM_BACKOFF_BASE_MS),
      config.getPositiveInt("UPSTREAM_TOTAL_BUDGET_MS", DEFAULTS.UPSTREAM_TOTAL_BUDGET_MS),
    ]);

    const gate = await breakerService.shouldAttempt();
    if (!gate.allowed) {
      const record: UpstreamCallRecord = {
        attempt: 1,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        outcome: "CIRCUIT_OPEN",
        statusCode: null,
        retryAfterSec: null,
        error: maskText(gate.reason).slice(0, 500),
      };
      await this.persist(applicationId, record);
      logger.warn({
        event: "upstream.attempt",
        application_id: applicationId,
        attempt: 1,
        outcome: "CIRCUIT_OPEN",
        duration_ms: 0,
        status_code: null,
        circuit: gate.state,
        reason: gate.reason,
      });
      return null;
    }

    const probe = gate.state === "HALF_OPEN";
    const url =
      `${root}/verify?gstin=${encodeURIComponent(gstin)}` +
      `&applied_on=${encodeURIComponent(appliedOn)}`;

    const budgetStartedAt = Date.now();
    const budgetLeft = (): number => totalBudgetMs - (Date.now() - budgetStartedAt);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (budgetLeft() <= 0) {
        logger.warn({
          event: "upstream.budget_exhausted",
          application_id: applicationId,
          attempts_made: attempt - 1,
          total_budget_ms: totalBudgetMs,
        });
        break;
      }

      const startedAt = new Date();
      const startedMs = Date.now();
      const outcome = await this.attemptOnce(url, Math.max(1, Math.min(timeoutMs, budgetLeft())));
      const durationMs = Date.now() - startedMs;

      const record: UpstreamCallRecord = {
        attempt,
        startedAt: startedAt.toISOString(),
        durationMs,
        outcome: outcome.outcome,
        statusCode: outcome.statusCode,
        retryAfterSec: outcome.retryAfterSec,
        error: outcome.error === null ? null : maskText(outcome.error).slice(0, 500),
      };
      await this.persist(applicationId, record);

      const line = {
        event: "upstream.attempt",
        application_id: applicationId,
        attempt,
        outcome: record.outcome,
        duration_ms: durationMs,
        status_code: record.statusCode,
        probe,
      };
      if (record.outcome === "SUCCESS") logger.info(line);
      else logger.warn(line);

      if (outcome.outcome === "SUCCESS" && outcome.result) {
        await breakerService.recordSuccess();
        return outcome.result;
      }

      if (outcome.outcome === "RATE_LIMITED") {
        await breakerService.recordRateLimited(outcome.error ?? "rate limited");
        if (probe) await breakerService.releaseProbe();
      } else {
        await breakerService.recordFailure(outcome.error ?? outcome.outcome);
      }

      if (probe) break;
      if (attempt >= maxAttempts) break;

      let waitMs: number;
      if (outcome.outcome === "RATE_LIMITED") {
        const retryAfter = Math.min(outcome.retryAfterSec ?? 1, MAX_RETRY_AFTER_SEC);
        waitMs = Math.max(0, retryAfter) * 1000;
      } else {
        const base = backoffBaseMs * Math.pow(2, attempt - 1);
        const jitter = 1 + (Math.random() * 0.4 - 0.2);
        waitMs = Math.round(base * jitter);
      }

      const remaining = budgetLeft();
      if (waitMs >= remaining) {
        logger.warn({
          event: "upstream.budget_exhausted",
          application_id: applicationId,
          attempts_made: attempt,
          wait_ms: waitMs,
          budget_left_ms: Math.max(0, remaining),
        });
        break;
      }
      await sleep(waitMs);
    }

    return null;
  };

  private baseUrl = async (): Promise<string> => {
    try {
      const raw = await config.get("UPSTREAM_BASE_URL");
      const value = (raw ?? "").trim();
      return (value || DEFAULTS.UPSTREAM_BASE_URL).replace(/\/+$/, "");
    } catch {
      return DEFAULTS.UPSTREAM_BASE_URL;
    }
  };

  private persist = async (applicationId: string, record: UpstreamCallRecord): Promise<void> => {
    try {
      await upstreamCallRepository.create(applicationId, {
        attempt: record.attempt,
        startedAt: new Date(record.startedAt),
        durationMs: record.durationMs,
        outcome: record.outcome,
        statusCode: record.statusCode ?? null,
        retryAfterSec: record.retryAfterSec ?? null,
        error: record.error ?? null,
      });
    } catch (err) {
      logger.warn({ event: "upstream.call_persist_failed", err: maskedError(err) });
    }
  };

  private attemptOnce = async (url: string, timeoutMs: number): Promise<AttemptResult> => {
    const blank: AttemptResult = {
      outcome: "SUCCESS",
      statusCode: null,
      retryAfterSec: null,
      error: null,
      result: null,
    };

    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json" },
      });
      const statusCode = res.status;

      if (statusCode === 429) {
        const retryAfterSec = parseRetryAfter(res.headers.get("retry-after"));
        await res.text().catch(() => "");
        return {
          ...blank,
          outcome: "RATE_LIMITED",
          statusCode,
          retryAfterSec,
          error: `rate limited by upstream (retry-after=${retryAfterSec ?? "absent"})`,
        };
      }

      if (statusCode >= 500) {
        const body = await res.text().catch(() => "");
        return {
          ...blank,
          outcome: "HTTP_5XX",
          statusCode,
          error: `upstream returned ${statusCode}: ${body.slice(0, 200)}`,
        };
      }

      if (statusCode >= 400) {
        const body = await res.text().catch(() => "");
        return {
          ...blank,
          outcome: "HTTP_4XX",
          statusCode,
          error: `upstream returned ${statusCode}: ${body.slice(0, 200)}`,
        };
      }

      const text = await res.text();

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          ...blank,
          outcome: "CONN_RESET",
          statusCode,
          error: `malformed body: ${text.length} bytes of non-JSON`,
        };
      }

      if (!isUpstreamResult(parsed)) {
        return {
          ...blank,
          outcome: "CONN_RESET",
          statusCode,
          error: "malformed body: JSON without gstin/status",
        };
      }

      return { ...blank, outcome: "SUCCESS", statusCode, result: parsed };
    } catch (err) {
      if (isTimeout(err)) {
        return {
          ...blank,
          outcome: "TIMEOUT",
          error: `no response within ${timeoutMs}ms: ${errorText(err)}`,
        };
      }
      return { ...blank, outcome: "CONN_RESET", error: errorText(err) };
    }
  };
}

export const upstreamService = new UpstreamService();

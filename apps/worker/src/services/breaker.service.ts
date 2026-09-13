import type { UpstreamState } from "@deepvue/db";
import { upstreamStateRepository } from "@deepvue/db";
import { config, logger, maskedError } from "@deepvue/platform";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_OPEN_MS = 30_000;

const HALF_OPEN_PROBE_TTL_MS = 60_000;

export interface AttemptGate {
  allowed: boolean;
  state: CircuitState;
  reason: string;
}

export class BreakerService {
  read = async (): Promise<UpstreamState> => upstreamStateRepository.read();

  openMs = async (): Promise<number> =>
    config.getPositiveInt("BREAKER_OPEN_MS", DEFAULT_OPEN_MS);

  shouldAttempt = async (now: Date = new Date()): Promise<AttemptGate> => {
    const row = await this.read();
    const circuit = (row.circuit as CircuitState) ?? "CLOSED";
    const windowMs = await this.openMs();

    if (circuit === "CLOSED") {
      return { allowed: true, state: "CLOSED", reason: "circuit_closed" };
    }

    if (circuit === "OPEN") {
      const openedAt = row.openedAt ?? now;
      const reopenAt = openedAt.getTime() + windowMs;
      if (reopenAt > now.getTime()) {
        const remaining = Math.max(0, reopenAt - now.getTime());
        return {
          allowed: false,
          state: "OPEN",
          reason: `circuit_open: ${row.consecutiveFailures} consecutive failures, retry in ${Math.ceil(remaining / 1000)}s`,
        };
      }

      if (await upstreamStateRepository.tryOpenProbe(row.openedAt)) {
        logger.info({
          event: "upstream.circuit_half_open",
          consecutive_failures: row.consecutiveFailures,
        });
        return { allowed: true, state: "HALF_OPEN", reason: "half_open_probe" };
      }
      return {
        allowed: false,
        state: "HALF_OPEN",
        reason: "circuit_half_open: another probe is already in flight",
      };
    }

    const staleSince = (row.openedAt ?? now).getTime() + windowMs + HALF_OPEN_PROBE_TTL_MS;
    if (staleSince <= now.getTime()) {
      if (await upstreamStateRepository.reclaimProbe(row.openedAt, now)) {
        logger.warn({
          event: "upstream.circuit_probe_reclaimed",
          consecutive_failures: row.consecutiveFailures,
        });
        return { allowed: true, state: "HALF_OPEN", reason: "half_open_probe_reclaimed" };
      }
    }
    return {
      allowed: false,
      state: "HALF_OPEN",
      reason: "circuit_half_open: another probe is already in flight",
    };
  };

  recordSuccess = async (now: Date = new Date()): Promise<void> => {
    const before = await this.read();
    await upstreamStateRepository.recordSuccess(now);
    if (before.circuit !== "CLOSED") {
      logger.info({
        event: "upstream.circuit_closed",
        previous_circuit: before.circuit,
        consecutive_failures_cleared: before.consecutiveFailures,
      });
    }
  };

  recordFailure = async (err: unknown, now: Date = new Date()): Promise<void> => {
    const threshold = await config.getPositiveInt(
      "BREAKER_FAILURE_THRESHOLD",
      DEFAULT_FAILURE_THRESHOLD,
    );
    await this.read();

    const transition = await upstreamStateRepository.recordFailure(
      maskedError(err),
      threshold,
      now,
    );

    if (transition && transition.circuit === "OPEN" && transition.previousCircuit !== "OPEN") {
      logger.warn({
        event: "upstream.circuit_opened",
        consecutive_failures: transition.consecutiveFailures,
        previous_circuit: transition.previousCircuit,
        open_for_ms: await this.openMs(),
      });
    }
  };

  recordRateLimited = async (err: unknown, now: Date = new Date()): Promise<void> => {
    await this.read();
    await upstreamStateRepository.recordRateLimited(maskedError(err), now);
  };

  releaseProbe = async (now: Date = new Date()): Promise<void> =>
    upstreamStateRepository.releaseProbe(now);
}

export const breakerService = new BreakerService();

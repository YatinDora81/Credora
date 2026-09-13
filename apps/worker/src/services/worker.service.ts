import type { Application } from "@deepvue/db";
import { applicationRepository } from "@deepvue/db";
import { config, errorText, logger, newRequestId, withContext } from "@deepvue/platform";
import { breakerService } from "./breaker.service";
import { geminiKeys } from "./gemini-keys";
import { pipelineService } from "./pipeline.service";

const DEFAULTS = {
  WORKER_POLL_INTERVAL_MS: 1000,
  WORKER_BATCH_SIZE: 5,
  WATCHDOG_INTERVAL_MS: 10_000,
  WATCHDOG_STALE_MS: 120_000,
  WORKER_MAX_ATTEMPTS: 3,
} as const;

const MAX_INFLIGHT_BATCHES = 4;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface WorkerStats {
  stopping: boolean;
  inFlight: number;
  lastLoopAt: number;
  lastClaimFailed: boolean;
  pollIntervalMs: number;
}

export class WorkerService {
  private stopping = false;
  private readonly inFlight = new Set<Promise<unknown>>();
  private lastLoopAt = 0;
  private lastClaimFailed = false;
  private pollIntervalMs: number = DEFAULTS.WORKER_POLL_INTERVAL_MS;

  stats = (): WorkerStats => ({
    stopping: this.stopping,
    inFlight: this.inFlight.size,
    lastLoopAt: this.lastLoopAt,
    lastClaimFailed: this.lastClaimFailed,
    pollIntervalMs: this.pollIntervalMs,
  });

  run = async (): Promise<void> => {
    await this.logStartup();
    await Promise.all([this.claimLoop(), this.watchdogLoop()]);
  };

  shutdown = async (signal: string): Promise<void> => {
    if (this.stopping) {
      logger.warn({ event: "worker.shutdown_forced", signal });
      process.exit(1);
    }
    this.stopping = true;
    logger.info({ event: "worker.shutdown_started", signal, in_flight: this.inFlight.size });
    await Promise.allSettled([...this.inFlight]);
    logger.info({ event: "worker.shutdown_complete", signal });
  };

  private claimLoop = async (): Promise<void> => {
    while (!this.stopping) {
      this.lastLoopAt = Date.now();
      const pollIntervalMs = await config.getPositiveInt(
        "WORKER_POLL_INTERVAL_MS",
        DEFAULTS.WORKER_POLL_INTERVAL_MS,
      );
      this.pollIntervalMs = pollIntervalMs;
      const batchSize = await config.getPositiveInt(
        "WORKER_BATCH_SIZE",
        DEFAULTS.WORKER_BATCH_SIZE,
      );

      const maxInFlight = batchSize * MAX_INFLIGHT_BATCHES;
      if (this.inFlight.size >= maxInFlight) {
        await sleep(pollIntervalMs);
        continue;
      }

      let claimed = 0;
      try {
        claimed = await this.claimOnce(Math.min(batchSize, maxInFlight - this.inFlight.size));
        this.lastClaimFailed = false;
      } catch (err) {
        this.lastClaimFailed = true;
        logger.error({ event: "worker.claim_failed", error: errorText(err) });
      }

      if (this.stopping) break;
      if (claimed < batchSize) await sleep(pollIntervalMs);
    }
  };

  private claimOnce = async (batchSize: number): Promise<number> => {
    const rows: Application[] = await applicationRepository.claimPending(batchSize);
    if (rows.length === 0) return 0;

    for (const row of rows) {
      withContext({ request_id: newRequestId(), application_id: row.id }, () => {
        logger.info({
          event: "application.claimed",
          application_id: row.id,
          attempt: row.attempts,
          policy_customer: row.policyCustomerKey,
          policy_version: row.policyVersion,
        });
      });
    }

    const batch = rows.map((row) =>
      this.track(pipelineService.process(row)).catch((err) => {
        logger.error({
          event: "application.failed",
          application_id: row.id,
          error: errorText(err),
        });
        return { status: "FAILED" as const, decision: null };
      }),
    );

    void Promise.allSettled(batch);
    return rows.length;
  };

  private watchdogLoop = async (): Promise<void> => {
    while (!this.stopping) {
      const intervalMs = await config.getPositiveInt(
        "WATCHDOG_INTERVAL_MS",
        DEFAULTS.WATCHDOG_INTERVAL_MS,
      );
      await sleep(intervalMs);
      if (this.stopping) break;

      try {
        const [maxAttempts, staleMs] = await Promise.all([
          config.getPositiveInt("WORKER_MAX_ATTEMPTS", DEFAULTS.WORKER_MAX_ATTEMPTS),
          config.getPositiveInt("WATCHDOG_STALE_MS", DEFAULTS.WATCHDOG_STALE_MS),
        ]);
        const reaped = await applicationRepository.reapStale(maxAttempts, staleMs);
        if (reaped > 0) {
          logger.warn({
            event: "worker.watchdog_reaped",
            rows: reaped,
            stale_ms: staleMs,
            max_attempts: maxAttempts,
          });
        }
      } catch (err) {
        logger.error({ event: "worker.watchdog_failed", error: errorText(err) });
      }
    }
  };

  private track = <T>(p: Promise<T>): Promise<T> => {
    const tracked = p.finally(() => {
      this.inFlight.delete(tracked);
    });
    this.inFlight.add(tracked);
    return tracked as Promise<T>;
  };

  private logStartup = async (): Promise<void> => {
    const [pollIntervalMs, batchSize, watchdogIntervalMs] = await Promise.all([
      config.getPositiveInt("WORKER_POLL_INTERVAL_MS", DEFAULTS.WORKER_POLL_INTERVAL_MS),
      config.getPositiveInt("WORKER_BATCH_SIZE", DEFAULTS.WORKER_BATCH_SIZE),
      config.getPositiveInt("WATCHDOG_INTERVAL_MS", DEFAULTS.WATCHDOG_INTERVAL_MS),
    ]);

    let circuit = "UNKNOWN";
    try {
      circuit = (await breakerService.read()).circuit;
    } catch (err) {
      logger.error({ event: "worker.breaker_read_failed", error: errorText(err) });
    }

    logger.info({
      event: "worker.started",
      poll_interval_ms: pollIntervalMs,
      batch_size: batchSize,
      watchdog_interval_ms: watchdogIntervalMs,
      model_outage: await config.getBool("MODEL_OUTAGE", false),
      model: await config.get("MODEL_NAME"),
      model_keys: geminiKeys.size,
      model_key_labels: geminiKeys.labels(),
      upstream_base_url: await config.get("UPSTREAM_BASE_URL"),
      circuit,
    });
  };
}

export const workerService = new WorkerService();

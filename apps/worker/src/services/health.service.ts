import { config, errorText, logger } from "@deepvue/platform";
import { workerService } from "./worker.service";

const DEFAULT_PORT = 4100;
const STALL_FLOOR_MS = 30_000;
const STALL_POLL_MULTIPLE = 5;

export type WorkerHealthStatus = "starting" | "ok" | "degraded" | "stalled" | "stopping";

export interface WorkerHealthSnapshot {
  ok: true;
  service: "worker";
  status: WorkerHealthStatus;
  uptime_s: number;
  in_flight: number;
  last_loop_at: string | null;
}

export class HealthService {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private readonly startedAt = Date.now();

  snapshot = (now: number = Date.now()): WorkerHealthSnapshot => {
    const stats = workerService.stats();
    const stallAfterMs = Math.max(STALL_FLOOR_MS, stats.pollIntervalMs * STALL_POLL_MULTIPLE);

    let status: WorkerHealthStatus = "ok";
    if (stats.stopping) status = "stopping";
    else if (stats.lastLoopAt === 0) status = now - this.startedAt > stallAfterMs ? "stalled" : "starting";
    else if (now - stats.lastLoopAt > stallAfterMs) status = "stalled";
    else if (stats.lastClaimFailed) status = "degraded";

    return {
      ok: true,
      service: "worker",
      status,
      uptime_s: Math.floor((now - this.startedAt) / 1000),
      in_flight: stats.inFlight,
      last_loop_at: stats.lastLoopAt ? new Date(stats.lastLoopAt).toISOString() : null,
    };
  };

  start = (): void => {
    if (this.server) return;
    const port = config.getIntSync("WORKER_PORT", DEFAULT_PORT);
    try {
      this.server = Bun.serve({
        port,
        fetch: (req) => {
          const { pathname } = new URL(req.url);
          const isHealth = pathname === "/health" || pathname === "/health/";
          if (isHealth && (req.method === "GET" || req.method === "HEAD")) {
            return Response.json(this.snapshot(), { headers: { "cache-control": "no-store" } });
          }
          return Response.json({ error: "not_found" }, { status: 404 });
        },
        error: (err) => {
          logger.error({ event: "worker.health_request_failed", error: errorText(err) });
          return Response.json({ error: "internal_error" }, { status: 500 });
        },
      });
      logger.info({ event: "worker.health_listening", port: this.server.port });
    } catch (err) {
      logger.error({ event: "worker.health_listen_failed", port, error: errorText(err) });
    }
  };

  stop = (): void => {
    this.server?.stop(true);
    this.server = null;
  };
}

export const healthService = new HealthService();

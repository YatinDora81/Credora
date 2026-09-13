import { config, logger } from "@deepvue/platform";

const PROBE_TIMEOUT_MS = 3_000;
const MIN_PROBE_INTERVAL_MS = 1_000;

export type ServiceName = "api" | "worker" | "mock_upstream";

export interface ServiceLiveness {
  reachable: boolean;
  status: string | null;
  latency_ms: number | null;
  error: string | null;
}

export interface KeepaliveSnapshot {
  status: "ok" | "degraded";
  checked_at: string;
  services: Record<ServiceName, ServiceLiveness>;
}

function isAbort(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

const REMOTE_TARGETS: { name: Exclude<ServiceName, "api">; baseUrlKey: string }[] = [
  { name: "worker", baseUrlKey: "WORKER_BASE_URL" },
  { name: "mock_upstream", baseUrlKey: "UPSTREAM_BASE_URL" },
];

export class KeepaliveService {
  private last: { at: number; snapshot: KeepaliveSnapshot } | null = null;
  private inFlight: Promise<KeepaliveSnapshot> | null = null;
  private readonly lastReachable = new Map<ServiceName, boolean>();

  check = (): Promise<KeepaliveSnapshot> => {
    if (this.last && Date.now() - this.last.at < MIN_PROBE_INTERVAL_MS) {
      return Promise.resolve(this.last.snapshot);
    }
    if (!this.inFlight) {
      this.inFlight = this.probeAll().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  };

  private probeAll = async (): Promise<KeepaliveSnapshot> => {
    const remote = await Promise.all(
      REMOTE_TARGETS.map(async (t) => [t.name, await this.probe(t.name, t.baseUrlKey)] as const),
    );

    const services = {
      api: { reachable: true, status: "ok", latency_ms: null, error: null },
      ...Object.fromEntries(remote),
    } as Record<ServiceName, ServiceLiveness>;

    const snapshot: KeepaliveSnapshot = {
      status: Object.values(services).every((s) => s.status === "ok") ? "ok" : "degraded",
      checked_at: new Date().toISOString(),
      services,
    };
    this.last = { at: Date.now(), snapshot };
    return snapshot;
  };

  private probe = async (name: ServiceName, baseUrlKey: string): Promise<ServiceLiveness> => {
    const baseUrl = config.getSync(baseUrlKey)?.trim();
    if (!baseUrl) {
      return this.record(name, { reachable: false, status: null, latency_ms: null, error: "not_configured" });
    }

    const started = Date.now();
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/health`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      let body: { status?: unknown } | null = null;
      try {
        body = (await res.json()) as { status?: unknown } | null;
      } catch (err) {
        if (isAbort(err)) throw err;
      }
      const status = typeof body?.status === "string" ? body.status : null;
      const healthy = res.ok && status !== null;
      return this.record(name, {
        reachable: healthy,
        status: healthy ? status : null,
        latency_ms: Date.now() - started,
        error: !res.ok ? `http_${res.status}` : healthy ? null : "invalid_body",
      });
    } catch (err) {
      return this.record(name, {
        reachable: false,
        status: null,
        latency_ms: null,
        error: isAbort(err) ? "timeout" : "unreachable",
      });
    }
  };

  private record = (name: ServiceName, liveness: ServiceLiveness): ServiceLiveness => {
    const previous = this.lastReachable.get(name);
    this.lastReachable.set(name, liveness.reachable);
    if (previous !== liveness.reachable) {
      if (liveness.reachable) {
        if (previous === false) logger.info({ service: name }, "keepalive.service_recovered");
      } else {
        logger.warn({ service: name, error: liveness.error }, "keepalive.service_unreachable");
      }
    }
    return liveness;
  };
}

export const keepaliveService = new KeepaliveService();

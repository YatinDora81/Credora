import { applicationRepository, upstreamStateRepository } from "@deepvue/db";
import { config, logger } from "@deepvue/platform";

const MODEL_CACHE_TTL_MS = 30_000;
const MODEL_PROBE_TIMEOUT_MS = 2_500;

interface ModelProbe {
  reachable: boolean;
  reason: string | null;
  checkedAt: number;
  model: string;
}

export interface HealthSnapshot {
  status: "ok" | "degraded";
  service: { ok: boolean; db: string };
  upstream: Record<string, unknown>;
  model: Record<string, unknown>;
  queue: Record<string, unknown>;
}

export class HealthService {
  private modelProbeCache: ModelProbe | null = null;

  snapshot = async (): Promise<HealthSnapshot> => {
    const db = await this.probeDb();
    const upstream = await this.upstreamView();
    const model = await this.modelView();
    const queue = await this.queueView();

    const ok = db === "ok" && upstream.circuit === "CLOSED" && model.reachable === true;

    return {
      status: ok ? "ok" : "degraded",
      service: { ok: db === "ok", db },
      upstream,
      model,
      queue,
    };
  };

  private probeDb = async (): Promise<string> => {
    try {
      await applicationRepository.ping();
      return "ok";
    } catch (err) {
      logger.error({ err }, "health.db_unreachable");
      return "error";
    }
  };

  private upstreamView = async (): Promise<Record<string, unknown>> => {
    const baseUrl = (await config.get("UPSTREAM_BASE_URL")) ?? null;
    try {
      const state = await upstreamStateRepository.find();
      return {
        circuit: state?.circuit ?? "UNKNOWN",
        consecutive_failures: state?.consecutiveFailures ?? 0,
        opened_at: state?.openedAt ? state.openedAt.toISOString() : null,
        last_success_at: state?.lastSuccessAt ? state.lastSuccessAt.toISOString() : null,
        last_failure_at: state?.lastFailureAt ? state.lastFailureAt.toISOString() : null,
        base_url: baseUrl,
      };
    } catch {
      return {
        circuit: "UNKNOWN",
        consecutive_failures: 0,
        opened_at: null,
        last_success_at: null,
        last_failure_at: null,
        base_url: baseUrl,
      };
    }
  };

  private modelView = async (): Promise<Record<string, unknown>> => {
    const modelName = (await config.get("MODEL_NAME")) ?? "gemini-2.5-flash";

    if (await config.getBool("MODEL_OUTAGE", false)) {
      return {
        reachable: false,
        outage_simulated: true,
        reason: "MODEL_OUTAGE",
        last_checked_at: new Date().toISOString(),
        model: modelName,
      };
    }

    const probe = await this.probeModel(modelName);
    return {
      reachable: probe.reachable,
      outage_simulated: false,
      reason: probe.reason,
      last_checked_at: new Date(probe.checkedAt).toISOString(),
      model: modelName,
    };
  };

  private queueView = async (): Promise<Record<string, unknown>> => {
    try {
      const [pending, processing, oldest] = await Promise.all([
        applicationRepository.countByStatus("PENDING"),
        applicationRepository.countByStatus("PROCESSING"),
        applicationRepository.oldestPendingCreatedAt(),
      ]);
      return {
        pending,
        processing,
        oldest_pending_age_ms: oldest ? Math.max(0, Date.now() - oldest.getTime()) : 0,
      };
    } catch {
      return { pending: 0, processing: 0, oldest_pending_age_ms: 0 };
    }
  };

  private configuredKey = (): string | null => {
    const pool = config.getSync("GEMINI_API_KEYS");
    if (pool) {
      const first = pool.split(",")[0]?.trim() ?? "";
      const key = first.includes("__SPLIT__") ? (first.split("__SPLIT__")[1] ?? "") : first;
      if (key.trim() !== "") return key.trim();
    }
    const single = config.getSync("GEMINI_API_KEY");
    return single && single.trim() !== "" ? single.trim() : null;
  };

  private probeModel = async (model: string): Promise<ModelProbe> => {
    const now = Date.now();
    const cached = this.modelProbeCache;
    if (cached && cached.model === model && now - cached.checkedAt < MODEL_CACHE_TTL_MS) {
      return cached;
    }

    const key = this.configuredKey();
    if (!key) {
      this.modelProbeCache = {
        reachable: false,
        reason: "no_api_key_configured",
        checkedAt: now,
        model,
      };
      return this.modelProbeCache;
    }

    let reachable = false;
    let reason: string | null = null;
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
        {
          method: "GET",
          headers: { "x-goog-api-key": key },
          signal: AbortSignal.timeout(MODEL_PROBE_TIMEOUT_MS),
        },
      );
      reachable = res.ok;
      if (!res.ok) reason = `http_${res.status}`;
    } catch (err) {
      reason = (err as { name?: string })?.name === "TimeoutError" ? "timeout" : "network_error";
    }

    this.modelProbeCache = { reachable, reason, checkedAt: Date.now(), model };
    return this.modelProbeCache;
  };
}

export const healthService = new HealthService();

import { runtimeConfigRepository } from "@deepvue/db";
import { logger } from "./logger";

export const OVERRIDABLE_KEYS = [
  "MODEL_OUTAGE",
  "KAVERI_ACTIVE_POLICY_VERSION",
  "NEXA_ACTIVE_POLICY_VERSION",
] as const;

export type OverridableKey = (typeof OVERRIDABLE_KEYS)[number];

export type ConfigSource = "db" | "env" | "default" | "unset";

export const DEFAULTS: Record<string, string> = {
  PORT: "3000",
  ADMIN_KEY: "dv_admin_local_only_change_me",

  WORKER_POLL_INTERVAL_MS: "1000",
  WORKER_BATCH_SIZE: "5",
  APPLICATION_DEADLINE_MS: "60000",
  WATCHDOG_INTERVAL_MS: "10000",
  WATCHDOG_STALE_MS: "120000",
  WORKER_MAX_ATTEMPTS: "3",
  WORKER_PORT: "4100",
  WORKER_BASE_URL: "http://worker:4100",

  UPSTREAM_BASE_URL: "http://mock-upstream:4000",
  UPSTREAM_TIMEOUT_MS: "4000",
  UPSTREAM_MAX_ATTEMPTS: "3",
  UPSTREAM_BACKOFF_BASE_MS: "500",
  UPSTREAM_TOTAL_BUDGET_MS: "20000",
  BREAKER_FAILURE_THRESHOLD: "5",
  BREAKER_OPEN_MS: "30000",

  GEMINI_API_KEY: "",
  GEMINI_API_KEYS: "",
  MODEL_NAME: "gemini-2.5-flash",
  MODEL_TIMEOUT_MS: "15000",
  MODEL_MAX_ATTEMPTS: "2",
  MODEL_OUTAGE: "false",
  MODEL_RPM_LIMIT: "8",
  MODEL_QUEUE_MAX_WAIT_MS: "20000",
  EXTRACTION_CACHE_ENABLED: "true",

  KAVERI_ACTIVE_POLICY_VERSION: "3.1",
  NEXA_ACTIVE_POLICY_VERSION: "1.4",
};

const CACHE_TTL_MS = 2000;

interface CacheEntry {
  value: string | null;
  at: number;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  return fallback;
}

function parseInt10(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export class ConfigService {
  private readonly cache = new Map<string, CacheEntry>();

  isOverridableKey = (key: string): key is OverridableKey =>
    (OVERRIDABLE_KEYS as readonly string[]).includes(key);

  invalidate = (key: string): void => {
    this.cache.delete(key);
  };

  getSync = (key: string): string | undefined => {
    const fromEnv = process.env[key];
    if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
    const fallback = DEFAULTS[key];
    return fallback === undefined || fallback === "" ? undefined : fallback;
  };

  getIntSync = (key: string, fallback: number): number =>
    parseInt10(this.getSync(key), fallback);

  get = async (key: string): Promise<string | undefined> => {
    const fromDb = await this.readDb(key);
    if (fromDb !== null && fromDb !== "") return fromDb;
    return this.getSync(key);
  };

  getBool = async (key: string, fallback = false): Promise<boolean> =>
    parseBool(await this.get(key), fallback);

  getInt = async (key: string, fallback: number): Promise<number> =>
    parseInt10(await this.get(key), fallback);

  getPositiveInt = async (key: string, fallback: number): Promise<number> => {
    try {
      const n = await this.getInt(key, fallback);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    } catch {
      return fallback;
    }
  };

  getWithSource = async (
    key: string,
  ): Promise<{ value: string | undefined; source: ConfigSource }> => {
    const fromDb = await this.readDb(key);
    if (fromDb !== null && fromDb !== "") return { value: fromDb, source: "db" };
    const fromEnv = process.env[key];
    if (fromEnv !== undefined && fromEnv !== "") return { value: fromEnv, source: "env" };
    const fallback = DEFAULTS[key];
    if (fallback !== undefined && fallback !== "") return { value: fallback, source: "default" };
    return { value: undefined, source: "unset" };
  };

  private readDb = async (key: string): Promise<string | null> => {
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;

    try {
      const value = await runtimeConfigRepository.get(key);
      this.cache.set(key, { value, at: Date.now() });
      return value;
    } catch (err) {
      logger.warn({ err, config_key: key }, "config.db_read_failed");
      return hit ? hit.value : null;
    }
  };
}

export const config = new ConfigService();

import { expect } from "bun:test";

const LOCAL_DATABASE_URL = "postgresql://deepvue:deepvue@localhost:5432/deepvue";

function resolveDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw || raw.trim() === "") return LOCAL_DATABASE_URL;
  if (/@postgres(:\d+)?\//.test(raw)) return LOCAL_DATABASE_URL;
  return raw;
}

export const DATABASE_URL = resolveDatabaseUrl();
process.env.DATABASE_URL = DATABASE_URL;

const db = await import("@deepvue/db");
export const prisma = db.prisma;

export const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

export const KAVERI_KEY = "dv_live_kaveri_7f3a9c2e";
export const NEXA_KEY = "dv_live_nexa_4b8d1e6a";
export const ADMIN_KEY = "dv_admin_local_only_change_me";

export const KAVERI_CUSTOMER_ID = "kaveri";
export const NEXA_CUSTOMER_ID = "nexa";

export const SAMPLE_PAN = "AAFCS4321K";
export const SAMPLE_GSTIN = "29AAFCS4321K1ZP";

export const TERMINAL_STATUSES = ["APPROVED", "REVIEW", "REJECTED", "FAILED"] as const;

export const CONFIG_SETTLE_MS = 2_600;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const core = await import("@deepvue/core");

export type SampleKey = "A.1" | "A.2.1" | "A.2.2" | "A.2.3" | "A.2.4";

export function sample(key: SampleKey = "A.1"): any {
  return JSON.parse(JSON.stringify((core as any).SAMPLES[key]));
}

export function sampleWithExternalId(externalId: string, key: SampleKey = "A.1"): any {
  const p = sample(key);
  p.application_id_external = externalId;
  return p;
}

function reservePort(): number {
  const s = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = s.port;
  s.stop(true);
  return port;
}

const VERBOSE = process.env.TEST_VERBOSE === "1";

class Collector {
  readonly lines: string[] = [];
  private partial = "";

  constructor(private readonly tag: string) {}

  attach(stream: ReadableStream<Uint8Array> | undefined | null): void {
    if (!stream) return;
    void (async () => {
      const decoder = new TextDecoder();
      try {
        for await (const chunk of stream as any) {
          this.partial += decoder.decode(chunk as Uint8Array, { stream: true });
          let nl: number;
          while ((nl = this.partial.indexOf("\n")) >= 0) {
            const line = this.partial.slice(0, nl);
            this.partial = this.partial.slice(nl + 1);
            this.lines.push(line);
            if (VERBOSE) console.log(`[${this.tag}] ${line}`);
          }
        }
      } catch {
      }
    })();
  }

  text(): string {
    return this.lines.join("\n") + (this.partial ? "\n" + this.partial : "");
  }

  count(): number {
    return this.lines.length + (this.partial.length > 0 ? 1 : 0);
  }
}

type Child = {
  name: string;
  proc: ReturnType<typeof Bun.spawn>;
  out: Collector;
};

const LIVE_CHILDREN = new Set<Child>();
process.on("exit", () => {
  for (const c of LIVE_CHILDREN) {
    try {
      c.proc.kill("SIGKILL");
    } catch {
    }
  }
});

function spawnChild(name: string, entry: string, env: Record<string, string>): Child {
  const proc = Bun.spawn(["bun", "run", entry], {
    cwd: REPO_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = new Collector(name);
  out.attach(proc.stdout as any);
  out.attach(proc.stderr as any);
  const child: Child = { name, proc, out };
  LIVE_CHILDREN.add(child);
  return child;
}

async function killChild(child: Child | null): Promise<void> {
  if (!child) return;
  LIVE_CHILDREN.delete(child);
  try {
    child.proc.kill("SIGTERM");
  } catch {
    return;
  }
  const exited = child.proc.exited.then(() => true);
  const timedOut = sleep(5_000).then(() => false);
  if (!(await Promise.race([exited, timedOut]))) {
    try {
      child.proc.kill("SIGKILL");
    } catch {
    }
    await Promise.race([child.proc.exited, sleep(2_000)]);
  }
}

export async function cleanDatabase(): Promise<void> {
  await prisma.upstreamCall.deleteMany({});
  await prisma.idempotencyRecord.deleteMany({});
  await prisma.application.deleteMany({});
  await prisma.extractionCache.deleteMany({});
  await prisma.runtimeConfig.deleteMany({});
  await reseed();
}

export async function reseed(): Promise<void> {
  const proc = Bun.spawn(["bun", "run", "packages/db/src/seed.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL } as Record<string, string>,
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr as any).text();
    throw new Error(`seed failed with exit code ${code}: ${err}`);
  }
  await prisma.upstreamState.update({
    where: { id: "upstream" },
    data: {
      circuit: "CLOSED",
      consecutiveFailures: 0,
      openedAt: null,
      lastError: null,
    },
  });
}

export type ChaosRates = { fail: number; hang: number; rateLimit: number };

export const NO_CHAOS: ChaosRates = { fail: 0, hang: 0, rateLimit: 0 };
export const DEFAULT_CHAOS: ChaosRates = { fail: 0.3, hang: 0.1, rateLimit: 0.05 };

export type HarnessOptions = {
  modelOutage?: boolean;
  startWorker?: boolean;
  chaos?: ChaosRates;
};

export type HttpResult<T = any> = {
  status: number;
  body: T;
  text: string;
  headers: Headers;
};

export class Harness {
  readonly apiPort: number;
  readonly mockPort: number;
  readonly apiUrl: string;
  readonly mockUrl: string;

  private api: Child | null = null;
  private worker: Child | null = null;
  private mock: Child | null = null;
  private readonly opts: Required<HarnessOptions>;

  constructor(opts: HarnessOptions = {}) {
    this.apiPort = reservePort();
    this.mockPort = reservePort();
    this.apiUrl = `http://127.0.0.1:${this.apiPort}`;
    this.mockUrl = `http://127.0.0.1:${this.mockPort}`;
    this.opts = {
      modelOutage: opts.modelOutage ?? true,
      startWorker: opts.startWorker ?? true,
      chaos: opts.chaos ?? NO_CHAOS,
    };
  }

  private baseEnv(): Record<string, string> {
    return {
      ...(process.env as Record<string, string>),
      DATABASE_URL,
      LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? "info",
      ADMIN_KEY,
      PORT: String(this.apiPort),
      UPSTREAM_BASE_URL: this.mockUrl,
      MODEL_OUTAGE: String(this.opts.modelOutage),
      EXTRACTION_CACHE_ENABLED: "true",
      KAVERI_ACTIVE_POLICY_VERSION: "3.1",
      NEXA_ACTIVE_POLICY_VERSION: "1.4",
      WORKER_POLL_INTERVAL_MS: "500",
      WORKER_BATCH_SIZE: "5",
      APPLICATION_DEADLINE_MS: "60000",
      WATCHDOG_INTERVAL_MS: "5000",
      WATCHDOG_STALE_MS: "120000",
      WORKER_MAX_ATTEMPTS: "3",
      UPSTREAM_TIMEOUT_MS: "4000",
      UPSTREAM_MAX_ATTEMPTS: "3",
      UPSTREAM_BACKOFF_BASE_MS: "500",
      UPSTREAM_TOTAL_BUDGET_MS: "20000",
      BREAKER_FAILURE_THRESHOLD: "5",
      BREAKER_OPEN_MS: "30000",
      MODEL_TIMEOUT_MS: "15000",
      MODEL_MAX_ATTEMPTS: "2",
      MODEL_RPM_LIMIT: "8",
      MODEL_QUEUE_MAX_WAIT_MS: "20000",
    };
  }

  async start(): Promise<void> {
    await cleanDatabase();
    await this.startMock();
    await this.startApi();
    if (this.opts.startWorker) await this.startWorker();
  }

  private async startMock(): Promise<void> {
    this.mock = spawnChild("mock", "apps/mock-upstream/src/server.ts", {
      ...this.baseEnv(),
      MOCK_PORT: String(this.mockPort),
      MOCK_ADMIN_KEY: ADMIN_KEY,
      MOCK_FAIL_RATE: String(this.opts.chaos.fail),
      MOCK_HANG_RATE: String(this.opts.chaos.hang),
      MOCK_RATE_LIMIT_RATE: String(this.opts.chaos.rateLimit),
      MOCK_HANG_SECONDS: "25",
    });
    await this.waitForHttp(`${this.mockUrl}/health`, "mock-upstream", 30_000);
    await this.setMockRates(this.opts.chaos);
  }

  private async startApi(): Promise<void> {
    this.api = spawnChild("api", "apps/api/src/server.ts", this.baseEnv());
    await this.waitForHttp(`${this.apiUrl}/v1/health`, "api", 40_000);
  }

  async startWorker(): Promise<void> {
    if (this.worker) throw new Error("worker already running");
    this.worker = spawnChild("worker", "apps/worker/src/main.ts", this.baseEnv());
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      if (this.worker.out.count() > 0) return;
      if (this.worker.proc.killed || this.worker.proc.exitCode !== null) {
        throw new Error(
          `worker exited during start-up (code ${this.worker.proc.exitCode}):\n${this.worker.out.text()}`,
        );
      }
      await sleep(100);
    }
    throw new Error(`worker produced no log line within 40s:\n${this.worker.out.text()}`);
  }

  async stop(): Promise<void> {
    await killChild(this.worker);
    this.worker = null;
    await killChild(this.api);
    this.api = null;
    await killChild(this.mock);
    this.mock = null;
  }

  private async waitForHttp(url: string, name: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = "";
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
        if (res.ok) {
          await res.text();
          return;
        }
        lastError = `HTTP ${res.status}`;
      } catch (e) {
        lastError = String((e as Error)?.message ?? e);
      }
      await sleep(150);
    }
    throw new Error(
      `${name} did not become ready at ${url} within ${timeoutMs}ms (last: ${lastError})\n` +
        `${name} output:\n${this.logsOf(name)}`,
    );
  }

  apiLog(): string {
    return this.api?.out.text() ?? "";
  }

  workerLog(): string {
    return this.worker?.out.text() ?? "";
  }

  mockLog(): string {
    return this.mock?.out.text() ?? "";
  }

  private logsOf(name: string): string {
    if (name === "api") return this.apiLog();
    if (name === "worker") return this.workerLog();
    return this.mockLog();
  }

  allServiceLog(): string {
    return this.apiLog() + "\n" + this.workerLog();
  }

  allServiceLines(): string[] {
    return [...(this.api?.out.lines ?? []), ...(this.worker?.out.lines ?? [])];
  }

  jsonLogLines(): Record<string, any>[] {
    const out: Record<string, any>[] = [];
    for (const line of this.allServiceLines()) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      try {
        const parsed = JSON.parse(t);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) out.push(parsed);
      } catch {
      }
    }
    return out;
  }

  private async request<T = any>(
    method: string,
    path: string,
    init: { headers?: Record<string, string>; body?: unknown } = {},
  ): Promise<HttpResult<T>> {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    let body: string | undefined;
    if (init.body !== undefined) {
      body = JSON.stringify(init.body);
      headers["content-type"] = "application/json";
    }
    const res = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text === "" ? null : JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed as T, text, headers: res.headers };
  }

  post(
    payload: unknown,
    opts: { apiKey?: string | null; idempotencyKey?: string } = {},
  ): Promise<HttpResult> {
    const headers: Record<string, string> = {};
    const key = opts.apiKey === undefined ? KAVERI_KEY : opts.apiKey;
    if (key !== null) headers["X-API-Key"] = key;
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return this.request("POST", "/v1/applications", { headers, body: payload });
  }

  get(id: string, apiKey: string | null = KAVERI_KEY): Promise<HttpResult> {
    const headers: Record<string, string> = {};
    if (apiKey !== null) headers["X-API-Key"] = apiKey;
    return this.request("GET", `/v1/applications/${encodeURIComponent(id)}`, { headers });
  }

  list(
    apiKey: string | null = KAVERI_KEY,
    params: Record<string, string | number> = {},
  ): Promise<HttpResult> {
    const headers: Record<string, string> = {};
    if (apiKey !== null) headers["X-API-Key"] = apiKey;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    const suffix = qs.toString() ? `?${qs}` : "";
    return this.request("GET", `/v1/applications${suffix}`, { headers });
  }

  health(): Promise<HttpResult> {
    return this.request("GET", "/v1/health", {});
  }

  admin(
    body: Record<string, string>,
    opts: { adminKey?: string | null } = {},
  ): Promise<HttpResult> {
    const headers: Record<string, string> = {};
    const key = opts.adminKey === undefined ? ADMIN_KEY : opts.adminKey;
    if (key !== null) headers["X-Admin-Key"] = key;
    return this.request("PUT", "/v1/admin/config", { headers, body });
  }

  adminGet(opts: { adminKey?: string | null } = {}): Promise<HttpResult> {
    const headers: Record<string, string> = {};
    const key = opts.adminKey === undefined ? ADMIN_KEY : opts.adminKey;
    if (key !== null) headers["X-Admin-Key"] = key;
    return this.request("GET", "/v1/admin/config", { headers });
  }

  async setConfig(body: Record<string, string>): Promise<void> {
    const res = await this.admin(body);
    if (res.status !== 200) {
      throw new Error(`admin config write failed: ${res.status} ${res.text}`);
    }
    await sleep(CONFIG_SETTLE_MS);
  }

  async setMockRates(rates: ChaosRates): Promise<void> {
    const res = await fetch(`${this.mockUrl}/admin/config`, {
      method: "PUT",
      headers: { "X-Admin-Key": ADMIN_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        MOCK_FAIL_RATE: rates.fail,
        MOCK_HANG_RATE: rates.hang,
        MOCK_RATE_LIMIT_RATE: rates.rateLimit,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`mock admin config failed: ${res.status} ${text}`);
  }

  async mockRates(): Promise<ChaosRates> {
    const res = await fetch(`${this.mockUrl}/admin/config`, {
      headers: { "X-Admin-Key": ADMIN_KEY },
      signal: AbortSignal.timeout(10_000),
    });
    const body: any = await res.json();
    return {
      fail: body.MOCK_FAIL_RATE,
      hang: body.MOCK_HANG_RATE,
      rateLimit: body.MOCK_RATE_LIMIT_RATE,
    };
  }

  async waitForTerminal(
    id: string,
    apiKey: string = KAVERI_KEY,
    timeoutMs = 90_000,
  ): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    let last: any = null;
    while (Date.now() < deadline) {
      const res = await this.get(id, apiKey);
      if (res.status !== 200) {
        throw new Error(`GET ${id} returned ${res.status}: ${res.text}`);
      }
      last = res.body;
      if ((TERMINAL_STATUSES as readonly string[]).includes(last?.status)) return last;
      await sleep(400);
    }
    throw new Error(
      `application ${id} did not reach a terminal state within ${timeoutMs}ms; ` +
        `last status=${last?.status}\n${await this.diagnose(id)}`,
    );
  }

  async diagnose(id: string): Promise<string> {
    const parts: string[] = [];
    try {
      const row = await prisma.application.findUnique({
        where: { id },
        select: { status: true, attempts: true, claimedAt: true, createdAt: true, deadlineAt: true },
      });
      parts.push(`row: ${JSON.stringify(row)}`);
      const queue = await prisma.application.groupBy({ by: ["status"], _count: { _all: true } });
      parts.push(`queue: ${queue.map((q) => `${q.status}=${q._count._all}`).join(" ")}`);
      const calls = await prisma.upstreamCall.count({ where: { applicationId: id } });
      parts.push(`upstream_calls: ${calls}`);
    } catch (e) {
      parts.push(`db probe failed: ${String(e)}`);
    }
    const w = this.worker;
    parts.push(
      w
        ? `worker: pid=${w.proc.pid} exitCode=${w.proc.exitCode} killed=${w.proc.killed} lines=${w.out.count()}`
        : "worker: not running",
    );
    if (w) parts.push("worker tail:\n" + w.out.lines.slice(-15).join("\n"));
    const a = this.api;
    parts.push(a ? `api: pid=${a.proc.pid} exitCode=${a.proc.exitCode}` : "api: not running");
    return parts.join("\n");
  }

  async waitForAllTerminal(
    ids: string[],
    apiKey: string = KAVERI_KEY,
    timeoutMs = 90_000,
  ): Promise<Record<string, any>> {
    const started = Date.now();
    const out: Record<string, any> = {};
    await Promise.all(
      ids.map(async (id) => {
        const remaining = () => timeoutMs - (Date.now() - started);
        out[id] = await this.waitForTerminal(id, apiKey, Math.max(1_000, remaining()));
      }),
    );
    return out;
  }
}

export async function startHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const h = new Harness(opts);
  await h.start();
  return h;
}

export async function countApplicationsByExternal(
  externalId: string,
  customerId?: string,
): Promise<number> {
  return prisma.application.count({
    where: { externalId, ...(customerId ? { customerId } : {}) },
  });
}

export async function countUpstreamCalls(applicationId: string): Promise<number> {
  return prisma.upstreamCall.count({ where: { applicationId } });
}

export function clause(body: any, clauseId: string): any {
  const reasons: any[] = body?.reasons ?? [];
  const found = reasons.find((r) => r?.clause_id === clauseId);
  expect(found, `clause ${clauseId} missing from reasons: ${JSON.stringify(reasons?.map((r) => r?.clause_id))}`).toBeDefined();
  return found;
}

export async function postAccepted(
  h: Harness,
  payload: unknown,
  opts: { apiKey?: string | null; idempotencyKey?: string } = {},
): Promise<string> {
  const res = await h.post(payload, opts);
  expect([200, 202], `unexpected POST status ${res.status}: ${res.text}`).toContain(res.status);
  expect(typeof res.body?.application_id).toBe("string");
  return res.body.application_id;
}

export function configValue(body: any, key: string): string | null {
  if (!body || typeof body !== "object") return null;
  for (const candidate of [body[key], body.config?.[key]]) {
    if (typeof candidate === "string") return candidate;
    if (candidate && typeof candidate === "object" && typeof candidate.value === "string") {
      return candidate.value;
    }
  }
  return null;
}

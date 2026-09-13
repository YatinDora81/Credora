import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startHarness, Harness, sleep } from "./helpers";

let h: Harness;

beforeAll(async () => {
  h = await startHarness({ startWorker: false });
}, 90_000);

afterAll(async () => {
  await h?.stop();
});

async function keepaliveUntil(
  predicate: (body: any) => boolean,
  timeoutMs = 15_000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    const res = await h.keepalive();
    expect(res.status).toBe(200);
    last = res.body;
    if (predicate(last)) return last;
    await sleep(250);
  }
  throw new Error(`keepalive never satisfied the predicate; last body: ${JSON.stringify(last)}`);
}

async function workerHealth(): Promise<{ status: number; body: any }> {
  const res = await fetch(`${h.workerUrl}/health`, { signal: AbortSignal.timeout(3_000) });
  return { status: res.status, body: await res.json() };
}

describe("service health and keep-alive", () => {
  it("serves /v1/keepalive with no API key and reports a missing worker without failing", async () => {
    const body = await keepaliveUntil((b) => b?.services?.mock_upstream?.status === "ok");
    expect(body.status).toBe("degraded");
    expect(body.services.api).toMatchObject({ reachable: true, status: "ok" });
    expect(body.services.mock_upstream.reachable).toBe(true);
    expect(body.services.worker).toMatchObject({ reachable: false, status: null });
    expect(typeof body.services.worker.error).toBe("string");
    expect(Number.isNaN(Date.parse(body.checked_at))).toBe(false);
  }, 30_000);

  it("exposes /health on the mock upstream", async () => {
    const res = await fetch(`${h.mockUrl}/health`, { signal: AbortSignal.timeout(3_000) });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toMatchObject({ ok: true, service: "mock-upstream", status: "ok" });
    expect(typeof body.uptime_s).toBe("number");
  });

  it("exposes /health on the worker once its claim loop is running", async () => {
    await h.startWorker();

    const deadline = Date.now() + 15_000;
    let last: { status: number; body: any } | null = null;
    while (Date.now() < deadline) {
      try {
        last = await workerHealth();
        if (last.body?.status === "ok") break;
      } catch {
      }
      await sleep(200);
    }

    if (last?.status !== 200 || last.body?.status !== "ok") {
      throw new Error(`worker /health never reported ok; last: ${JSON.stringify(last)}\n${h.workerLog()}`);
    }
    expect(last.body).toMatchObject({ ok: true, service: "worker", status: "ok" });
    expect(typeof last.body.in_flight).toBe("number");
    expect(Number.isNaN(Date.parse(last.body.last_loop_at))).toBe(false);

    const notFound = await fetch(`${h.workerUrl}/nope`, { signal: AbortSignal.timeout(3_000) });
    expect(notFound.status).toBe(404);
  }, 60_000);

  it("reports every service ok through /v1/keepalive once the worker is up", async () => {
    const body = await keepaliveUntil((b) => b?.status === "ok");
    for (const name of ["api", "worker", "mock_upstream"]) {
      expect(body.services[name]).toMatchObject({ reachable: true, status: "ok", error: null });
    }
    expect(body.services.api.latency_ms).toBeNull();
    expect(h.apiLog()).toContain("keepalive.service_recovered");
  }, 30_000);

  it("coalesces a burst of keep-alive calls into a single downstream probe", async () => {
    await sleep(1_100);
    const results = await Promise.all(Array.from({ length: 20 }, () => h.keepalive()));
    for (const r of results) expect(r.status).toBe(200);
    expect(new Set(results.map((r) => r.body.checked_at)).size).toBe(1);
  }, 30_000);

  it("keeps answering 200 and flags the worker when it goes away", async () => {
    await h.stopWorker();
    const body = await keepaliveUntil((b) => b?.services?.worker?.reachable === false);
    expect(body.status).toBe("degraded");
    expect(body.services.api.reachable).toBe(true);
    expect(h.apiLog().match(/keepalive\.service_unreachable/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it("does not log keep-alive requests at info level", () => {
    const level = (process.env.TEST_LOG_LEVEL ?? "info").toLowerCase();
    if (level === "debug" || level === "trace") return;
    expect(h.apiLog()).not.toContain('"path":"/v1/keepalive"');
  });
});

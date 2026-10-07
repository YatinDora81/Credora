import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startHarness, Harness, KAVERI_KEY, NEXA_KEY, sleep } from "./helpers";

let h: Harness;

async function policies(apiKey: string | null): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (apiKey !== null) headers["X-API-Key"] = apiKey;
  const res = await fetch(`${h.apiUrl}/v1/policies`, { headers, signal: AbortSignal.timeout(10_000) });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  h = await startHarness({ startWorker: false });
  await h.setConfig({ KAVERI_ACTIVE_POLICY_VERSION: "3.1" });
}, 150_000);

afterAll(async () => {
  try {
    if (h) await h.setConfig({ KAVERI_ACTIVE_POLICY_VERSION: "3.1" });
  } catch {
  }
  await h?.stop();
}, 60_000);

describe("GET /v1/policies", () => {
  it("requires an API key", async () => {
    const res = await policies(null);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("missing_api_key");
  });

  it("returns only the calling customer's versions, with the active one marked", async () => {
    const res = await policies(KAVERI_KEY);
    expect(res.status).toBe(200);
    expect(res.body.customer).toMatchObject({ id: "kaveri", policy_key: "kaveri_capital" });
    expect(res.body.active_version).toBe("3.1");
    expect(res.body.active_version_available).toBe(true);
    expect(res.body.versions.map((v: any) => v.version)).toEqual(["3.1", "3.2"]);
    for (const v of res.body.versions) {
      expect(v.policy.customer).toBe("kaveri_capital");
      expect(v.policy_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    const [v31, v32] = res.body.versions;
    expect(v31).toMatchObject({ active: true, extends: null, changed_clauses: [] });
    expect(v32).toMatchObject({ active: false, extends: "3.1", changed_clauses: ["A1"] });
    expect(JSON.stringify(res.body)).not.toContain("nexa_finserv");
  });

  it("gives another customer its own catalogue", async () => {
    const res = await policies(NEXA_KEY);
    expect(res.status).toBe(200);
    expect(res.body.customer.policy_key).toBe("nexa_finserv");
    expect(res.body.versions.map((v: any) => v.version)).toEqual(["1.4"]);
    expect(JSON.stringify(res.body)).not.toContain("kaveri_capital");
  });

  it("serves every seeded customer", async () => {
    const expected: Record<string, [string, string]> = {
      cr_live_tapti_28145a1a: ["tapti_tradefin", "2.0"],
      cr_live_palar_7ec8a7b6: ["palar_msme", "1.1"],
      cr_live_vamsadhara_d8c06574: ["vamsadhara_coop", "1.0"],
    };
    for (const [key, [policyKey, version]] of Object.entries(expected)) {
      const res = await policies(key);
      expect(res.status).toBe(200);
      expect(res.body.customer.policy_key).toBe(policyKey);
      expect(res.body.active_version).toBe(version);
      expect(res.body.versions.find((v: any) => v.active)?.version).toBe(version);
    }
  });

  it("follows an admin override of the active version", async () => {
    await h.setConfig({ KAVERI_ACTIVE_POLICY_VERSION: "3.2" });
    let body: any = null;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      body = (await policies(KAVERI_KEY)).body;
      if (body.active_version === "3.2") break;
      await sleep(250);
    }
    expect(body.active_version).toBe("3.2");
    expect(body.active_version_source).toBe("db");
    expect(body.versions.find((v: any) => v.active)?.version).toBe("3.2");
    await h.setConfig({ KAVERI_ACTIVE_POLICY_VERSION: "3.1" });
  }, 30_000);
});

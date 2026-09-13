import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startHarness,
  Harness,
  KAVERI_KEY,
  NEXA_KEY,
  sampleWithExternalId,
  postAccepted,
} from "./helpers";

let h: Harness;

const kaveriIds: string[] = [];
const nexaIds: string[] = [];

beforeAll(async () => {
  h = await startHarness();
  for (let i = 0; i < 3; i++) {
    kaveriIds.push(
      await postAccepted(h, sampleWithExternalId(`LN-ISO-KAVERI-${i}`), { apiKey: KAVERI_KEY }),
    );
  }
  for (let i = 0; i < 3; i++) {
    nexaIds.push(
      await postAccepted(h, sampleWithExternalId(`LN-ISO-NEXA-${i}`), { apiKey: NEXA_KEY }),
    );
  }
}, 150_000);

afterAll(async () => {
  await h?.stop();
});

describe("tenant isolation (§22)", () => {
  it("returns 404 — never 403 — for another customer's application", async () => {
    for (const id of nexaIds) {
      const res = await h.get(id, KAVERI_KEY);
      expect(res.status).toBe(404);
      expect(res.status).not.toBe(403);
      expect(res.text).not.toContain(id);
    }
    for (const id of kaveriIds) {
      const res = await h.get(id, NEXA_KEY);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain(id);
    }
  }, 60_000);

  it("gives an owner 200 for the very same ids", async () => {
    for (const id of nexaIds) {
      const res = await h.get(id, NEXA_KEY);
      expect(res.status).toBe(200);
      expect(res.body.application_id).toBe(id);
    }
  }, 60_000);

  it("returns the SAME response for a foreign id and a nonexistent one", async () => {
    const foreign = await h.get(nexaIds[0], KAVERI_KEY);
    const missing = await h.get("00000000-0000-4000-8000-000000000000", KAVERI_KEY);
    expect(foreign.status).toBe(missing.status);
    expect(foreign.body?.error).toBe(missing.body?.error);
  }, 30_000);

  async function walkList(apiKey: string, limit: number): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 200; page++) {
      const res = await h.list(apiKey, cursor ? { limit, cursor } : { limit });
      expect(res.status).toBe(200);
      const items: any[] = res.body?.items ?? res.body?.applications ?? res.body ?? [];
      expect(Array.isArray(items)).toBe(true);
      for (const item of items) seen.push(item.application_id);
      if (items.length < limit) break;
      const next = res.body?.next_cursor ?? items[items.length - 1]?.created_at;
      if (!next || next === cursor) break;
      cursor = next;
    }
    return seen;
  }

  it("never leaks another customer's ids through the list endpoint, at any limit or cursor", async () => {
    const nexaSet = new Set(nexaIds);
    for (const limit of [1, 2, 3, 20, 100]) {
      const seen = await walkList(KAVERI_KEY, limit);
      for (const id of seen) expect(nexaSet.has(id)).toBe(false);
    }
    const kaveriSet = new Set(kaveriIds);
    for (const id of await walkList(NEXA_KEY, 100)) expect(kaveriSet.has(id)).toBe(false);
  }, 120_000);

  it("still shows each customer all of its own applications", async () => {
    const kaveriSeen = await walkList(KAVERI_KEY, 100);
    for (const id of kaveriIds) expect(kaveriSeen).toContain(id);
    const nexaSeen = await walkList(NEXA_KEY, 100);
    for (const id of nexaIds) expect(nexaSeen).toContain(id);
  }, 120_000);

  it("returns 404 for an unknown uuid", async () => {
    const res = await h.get("11111111-2222-4333-8444-555555555555", KAVERI_KEY);
    expect(res.status).toBe(404);
  }, 30_000);

  it("returns 404 or 422 for a malformed id — never 500", async () => {
    for (const bad of ["not-a-uuid", "12345", "../../etc/passwd", "%20", "null"]) {
      const res = await h.get(bad, KAVERI_KEY);
      expect([404, 422]).toContain(res.status);
      expect(res.status).toBeLessThan(500);
    }
  }, 60_000);

  it("rejects a missing API key with 401 missing_api_key", async () => {
    const res = await h.get(kaveriIds[0], null);
    expect(res.status).toBe(401);
    expect(res.body?.error).toBe("missing_api_key");

    const posted = await h.post(sampleWithExternalId("LN-ISO-NOAUTH"), { apiKey: null });
    expect(posted.status).toBe(401);
    expect(posted.body?.error).toBe("missing_api_key");

    const listed = await h.list(null);
    expect(listed.status).toBe(401);
    expect(listed.body?.error).toBe("missing_api_key");
  }, 30_000);

  it("rejects an unknown API key with 401 invalid_api_key", async () => {
    const res = await h.get(kaveriIds[0], "dv_live_not_a_real_key");
    expect(res.status).toBe(401);
    expect(res.body?.error).toBe("invalid_api_key");

    const listed = await h.list("dv_live_not_a_real_key");
    expect(listed.status).toBe(401);
    expect(listed.body?.error).toBe("invalid_api_key");
  }, 30_000);

  it("serves /v1/health with no API key at all", async () => {
    const res = await h.health();
    expect(res.status).toBe(200);
    expect(res.body?.status === "ok" || res.body?.status === "degraded").toBe(true);
    expect(res.body?.service?.db).toBe("ok");
  }, 30_000);

  it("guards the admin config endpoint with X-Admin-Key", async () => {
    const noKey = await h.adminGet({ adminKey: null });
    expect(noKey.status).toBe(403);
    const wrongKey = await h.adminGet({ adminKey: "nope" });
    expect(wrongKey.status).toBe(403);
    const ok = await h.adminGet();
    expect(ok.status).toBe(200);

    const bad = await h.admin({ SOME_OTHER_KEY: "1" });
    expect(bad.status).toBe(400);
  }, 30_000);
});

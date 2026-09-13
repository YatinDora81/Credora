import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startHarness,
  Harness,
  KAVERI_KEY,
  sample,
  sampleWithExternalId,
  postAccepted,
  clause,
  configValue,
  prisma,
} from "./helpers";

const hasModelKey =
  (process.env.GEMINI_API_KEYS ?? "").trim() !== "" ||
  (process.env.GEMINI_API_KEY ?? "").trim() !== "";

const liveIt = hasModelKey ? it : it.skip;

let h: Harness;
let firstDecision: any = null;

function blankUndisclosedUnits(value: any): { changed: boolean; value: any } {
  let changed = false;
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(node)) {
        if (k === "undisclosed_units" && Array.isArray(v)) {
          changed = true;
          out[k] = [];
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    }
    return node;
  };
  const next = walk(value);
  return { changed, value: next };
}

beforeAll(async () => {
  if (!hasModelKey) {
    console.log(
      "[cache.test] SKIPPING the live-model half: neither GEMINI_API_KEYS nor " +
        "GEMINI_API_KEY is set in the environment. The MODEL_OUTAGE half below " +
        "still runs and is the assertion that matters most.",
    );
  }
  h = await startHarness({ modelOutage: false });
}, 150_000);

afterAll(async () => {
  try {
    if (h) await h.setConfig({ MODEL_OUTAGE: "false" });
  } catch {
  }
  await h?.stop();
}, 60_000);

describe("extraction cache (§12.4)", () => {
  liveIt(
    "extracts once and caches it",
    async () => {
      expect(await prisma.extractionCache.count()).toBe(0);

      const id = await postAccepted(h, sampleWithExternalId("LN-CACHE-1"), {
        apiKey: KAVERI_KEY,
      });
      firstDecision = await h.waitForTerminal(id, KAVERI_KEY, 90_000);

      expect(firstDecision.extraction?.available).toBe(true);

      const rows = await prisma.extractionCache.findMany();
      expect(rows.length).toBe(1);
      expect(typeof rows[0].inputHash).toBe("string");
      expect(rows[0].inputHash.length).toBeGreaterThan(16);
      expect(typeof rows[0].model).toBe("string");
      expect(rows[0].model.length).toBeGreaterThan(0);

      const a6 = clause(firstDecision, "A6");
      expect(a6.result).toBe("FAIL");
    },
    180_000,
  );

  liveIt(
    "serves the SECOND identical application from the cache instead of calling the model again",
    async () => {
      expect(firstDecision).toBeTruthy();

      const row = await prisma.extractionCache.findFirstOrThrow();
      const { changed, value } = blankUndisclosedUnits(row.extraction);
      expect(changed).toBe(true);
      await prisma.extractionCache.update({
        where: { inputHash: row.inputHash },
        data: { extraction: value },
      });

      const second = sampleWithExternalId("LN-CACHE-2");
      expect(second.unstructured).toEqual(sample("A.1").unstructured);

      const id = await postAccepted(h, second, { apiKey: KAVERI_KEY });
      const decision = await h.waitForTerminal(id, KAVERI_KEY, 90_000);

      expect(await prisma.extractionCache.count()).toBe(1);
      const after = await prisma.extractionCache.findFirstOrThrow();
      expect(after.inputHash).toBe(row.inputHash);

      expect(decision.extraction?.available).toBe(true);
      const a6 = clause(decision, "A6");
      expect(a6.result).toBe("PASS");
      expect(clause(firstDecision, "A6").result).toBe("FAIL");

      expect(clause(decision, "A1").result).toBe(clause(firstDecision, "A1").result);
      expect(clause(decision, "A3").result).toBe(clause(firstDecision, "A3").result);
    },
    180_000,
  );
});

describe("MODEL_OUTAGE bypasses the cache (§12.3, §24.5)", () => {
  it(
    "returns UNDETERMINED extraction-dependent clauses even when a cache row for that text exists",
    async () => {
      const cachedBefore = await prisma.extractionCache.count();
      if (hasModelKey) {
        expect(cachedBefore).toBe(1);
      }

      await h.setConfig({ MODEL_OUTAGE: "true" });

      const id = await postAccepted(h, sampleWithExternalId("LN-CACHE-OUTAGE"), {
        apiKey: KAVERI_KEY,
      });
      const decision = await h.waitForTerminal(id, KAVERI_KEY, 90_000);

      expect(["APPROVED", "REVIEW", "REJECTED"]).toContain(decision.status);
      expect(decision.status).not.toBe("FAILED");

      expect(decision.extraction?.available).toBe(false);
      expect(typeof decision.extraction?.reason).toBe("string");
      expect(decision.extraction.reason.length).toBeGreaterThan(0);

      const a6 = clause(decision, "A6");
      expect(a6.result).toBe("UNDETERMINED");
      expect(a6.outcome).toBe("REVIEW");
      expect(decision.degraded).toBe(true);
      expect(decision.degraded_reasons.some((r: string) => r.startsWith("A6"))).toBe(true);

      expect(clause(decision, "A1").result).toBe("FAIL");
      expect(clause(decision, "A2").result).toBe("PASS");
      expect(clause(decision, "A3").result).toBe("FAIL");
      expect(clause(decision, "A4").result).toBe("PASS");

      expect(await prisma.extractionCache.count()).toBe(cachedBefore);
    },
    180_000,
  );

  it(
    "is not a one-way door: clearing the switch restores normal behaviour",
    async () => {
      const cfg = await h.adminGet();
      expect(cfg.status).toBe(200);
      expect(configValue(cfg.body, "MODEL_OUTAGE")).toBe("true");

      await h.setConfig({ MODEL_OUTAGE: "false" });
      const health = await h.health();
      expect(health.status).toBe(200);
      expect(health.body?.model?.outage_simulated).toBe(false);
    },
    90_000,
  );
});

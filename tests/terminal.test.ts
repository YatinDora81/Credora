import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startHarness,
  Harness,
  KAVERI_KEY,
  DEFAULT_CHAOS,
  sampleWithExternalId,
  prisma,
} from "./helpers";

const COUNT = 20;
const BUDGET_MS = 90_000;

let h: Harness;
const ids: string[] = [];
const decisions: Record<string, any> = {};
let elapsedMs = 0;

beforeAll(async () => {
  h = await startHarness({ chaos: DEFAULT_CHAOS });
  const rates = await h.mockRates();
  expect(rates).toEqual(DEFAULT_CHAOS);

  const started = Date.now();
  const posted = await Promise.all(
    Array.from({ length: COUNT }, (_, i) =>
      h.post(sampleWithExternalId(`LN-CHAOS-${String(i).padStart(2, "0")}`), {
        apiKey: KAVERI_KEY,
        idempotencyKey: `chaos-${i}`,
      }),
    ),
  );
  for (const res of posted) {
    expect(res.status).toBe(202);
    ids.push(res.body.application_id);
  }

  const all = await h.waitForAllTerminal(ids, KAVERI_KEY, BUDGET_MS);
  elapsedMs = Date.now() - started;
  Object.assign(decisions, all);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe("terminal state under chaos (§20, §21.2, §21.3)", () => {
  it("reaches a terminal state for all 20 within 90 seconds", () => {
    expect(ids.length).toBe(COUNT);
    expect(new Set(ids).size).toBe(COUNT);
    expect(elapsedMs).toBeLessThan(BUDGET_MS);
    for (const id of ids) {
      expect(["APPROVED", "REVIEW", "REJECTED", "FAILED"]).toContain(decisions[id].status);
      expect(decisions[id].decided_at).toBeTruthy();
    }
  });

  it("leaves nothing stuck in PENDING or PROCESSING", async () => {
    const rows = await prisma.application.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, attempts: true },
    });
    expect(rows.length).toBe(COUNT);
    const stuck = rows.filter((r) => r.status === "PENDING" || r.status === "PROCESSING");
    expect(stuck.map((r) => `${r.id}:${r.status}`)).toEqual([]);
  });

  it("never turns upstream chaos into FAILED — FAILED is reserved for our own failure (§21.2)", () => {
    const failed = ids.filter((id) => decisions[id].status === "FAILED");
    expect(
      failed.map((id) => ({ id, reasons: decisions[id].reasons?.length ?? 0 })),
    ).toEqual([]);
  });

  it("marks degraded decisions as degraded AND shows an UNDETERMINED clause behind it", () => {
    let degradedCount = 0;
    for (const id of ids) {
      const d = decisions[id];
      const undetermined = (d.reasons ?? []).filter((r: any) => r.result === "UNDETERMINED");
      if (d.degraded === true) {
        degradedCount++;
        expect(undetermined.length).toBeGreaterThan(0);
        expect(Array.isArray(d.degraded_reasons)).toBe(true);
        expect(d.degraded_reasons.length).toBe(undetermined.length);
      } else {
        expect(undetermined.length).toBe(0);
      }
    }
    expect(degradedCount).toBeGreaterThan(0);
  });

  it("keeps every clause result inside the four-valued vocabulary (rule 4)", () => {
    const allowed = new Set(["PASS", "FAIL", "UNDETERMINED", "NOT_APPLICABLE"]);
    for (const id of ids) {
      const reasons = decisions[id].reasons ?? [];
      expect(reasons.length).toBeGreaterThan(0);
      for (const r of reasons) {
        expect(allowed.has(r.result)).toBe(true);
        expect(["APPROVE", "REVIEW", "REJECT"]).toContain(r.outcome);
      }
    }
  });

  it("records retries: at least one application made more than one upstream attempt", async () => {
    const grouped = await prisma.upstreamCall.groupBy({
      by: ["applicationId"],
      where: { applicationId: { in: ids } },
      _count: { _all: true },
    });
    expect(grouped.length).toBeGreaterThan(0);
    const maxAttempts = Math.max(...grouped.map((g) => g._count._all));
    expect(maxAttempts).toBeGreaterThan(1);

    const withRetries = grouped.find((g) => g._count._all > 1)!;
    const body = decisions[withRetries.applicationId];
    expect(Array.isArray(body.upstream_calls)).toBe(true);
    expect(body.upstream_calls.length).toBe(withRetries._count._all);
    const attempts = body.upstream_calls.map((c: any) => c.attempt);
    expect(attempts).toEqual([...attempts].sort((a, b) => a - b));

    const outcomes = new Set(
      (
        await prisma.upstreamCall.findMany({
          where: { applicationId: { in: ids } },
          select: { outcome: true },
        })
      ).map((c) => c.outcome),
    );
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it(
    "NEVER rejects on UNDETERMINED alone — every REJECTED has a determined FAIL with outcome REJECT (A7)",
    () => {
      const rejected = ids.filter((id) => decisions[id].status === "REJECTED");
      for (const id of rejected) {
        const reasons = decisions[id].reasons ?? [];
        const determinedRejects = reasons.filter(
          (r: any) => r.result === "FAIL" && r.outcome === "REJECT",
        );
        expect(
          determinedRejects.length,
          `application ${id} is REJECTED with no determined FAIL->REJECT clause; ` +
            `results were ${JSON.stringify(reasons.map((r: any) => [r.clause_id, r.result, r.outcome]))}`,
        ).toBeGreaterThan(0);
      }

      const cappedCandidates = ids.filter((id) => {
        const reasons = decisions[id].reasons ?? [];
        const a1 = reasons.find((r: any) => r.clause_id === "A1");
        return a1?.result === "UNDETERMINED";
      });
      for (const id of cappedCandidates) {
        expect(decisions[id].status).not.toBe("REJECTED");
      }
    },
  );

  it("decides every application against its pinned policy version", () => {
    for (const id of ids) {
      expect(decisions[id].policy.customer).toBe("kaveri_capital");
      expect(decisions[id].policy.version).toBe("3.1");
      expect(typeof decisions[id].evidence_hash).toBe("string");
      expect(typeof decisions[id].policy_hash).toBe("string");
    }
  });
});

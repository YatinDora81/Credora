import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startHarness,
  Harness,
  KAVERI_KEY,
  sampleWithExternalId,
  postAccepted,
  clause,
  configValue,
  prisma,
} from "./helpers";

let h: Harness;

beforeAll(async () => {
  h = await startHarness({ startWorker: false });
  await h.setConfig({ KAVERI_ACTIVE_POLICY_VERSION: "3.1" });
  const cfg = await h.adminGet();
  expect(cfg.status).toBe(200);
  expect(configValue(cfg.body, "KAVERI_ACTIVE_POLICY_VERSION")).toBe("3.1");
}, 150_000);

afterAll(async () => {
  try {
    if (h) await h.setConfig({ KAVERI_ACTIVE_POLICY_VERSION: "3.1" });
  } catch {
  }
  await h?.stop();
}, 60_000);

describe("policy version pinning (§24.1, §21.2)", () => {
  let pinnedId = "";

  it(
    "decides an in-flight application on the version pinned at intake, not the new active one",
    async () => {
      pinnedId = await postAccepted(h, sampleWithExternalId("LN-PIN-3-1"), {
        apiKey: KAVERI_KEY,
      });

      const row = await prisma.application.findUniqueOrThrow({ where: { id: pinnedId } });
      expect(row.status).toBe("PENDING");
      expect(row.policyVersion).toBe("3.1");
      expect(row.policyCustomerKey).toBe("kaveri_capital");

      const pending = await h.get(pinnedId, KAVERI_KEY);
      expect(pending.status).toBe(200);
      expect(pending.body.status).toBe("PROCESSING");

      await h.setConfig({ KAVERI_ACTIVE_POLICY_VERSION: "3.2" });

      await h.startWorker();
      const decided = await h.waitForTerminal(pinnedId, KAVERI_KEY, 90_000);

      expect(decided.policy.customer).toBe("kaveri_capital");
      expect(decided.policy.version).toBe("3.1");
      expect(decided.policy.active_version_now).toBe("3.2");

      const a1 = clause(decided, "A1");
      expect(a1.result).toBe("FAIL");
      expect(a1.outcome).toBe("REJECT");
      expect(a1.explanation).toContain("at least 36");
      expect(a1.explanation).toContain("2023-08-11");
      expect(a1.explanation).toContain("30 months");
      expect(a1.clause_text).toContain("36 months");

      expect(decided.status).toBe("REJECTED");

      const after = await prisma.application.findUniqueOrThrow({ where: { id: pinnedId } });
      expect(after.policyVersion).toBe("3.1");
    },
    180_000,
  );

  it(
    "pins 3.2 for an application created after the flip, and decides it differently",
    async () => {
      const newId = await postAccepted(h, sampleWithExternalId("LN-PIN-3-2"), {
        apiKey: KAVERI_KEY,
      });

      const row = await prisma.application.findUniqueOrThrow({ where: { id: newId } });
      expect(row.policyVersion).toBe("3.2");

      const decided = await h.waitForTerminal(newId, KAVERI_KEY, 90_000);
      expect(decided.policy.version).toBe("3.2");
      expect(decided.policy.active_version_now).toBe("3.2");

      const a1 = clause(decided, "A1");
      expect(a1.result).toBe("PASS");
      expect(a1.outcome).toBe("APPROVE");
      expect(a1.explanation).toContain("at least 24");
      expect(a1.clause_text).toContain("24 months");

      expect(decided.status).toBe("REVIEW");

      const older = await h.get(pinnedId, KAVERI_KEY);
      expect(older.body.status).toBe("REJECTED");
      expect(older.body.policy.version).toBe("3.1");
    },
    180_000,
  );

  it(
    "keeps the resolved policy document in the decision so the pinning is checkable",
    async () => {
      const decided = await h.get(pinnedId, KAVERI_KEY);
      expect(decided.status).toBe(200);
      const resolved = decided.body.policy?.resolved;
      expect(resolved).toBeTruthy();
      expect(resolved.version).toBe("3.1");
      const a1 = (resolved.clauses as any[]).find((c) => c.id === "A1");
      expect(a1).toBeTruthy();
      expect(a1.params.months).toBe(36);
      expect(a1.on_fail).toBe("REJECT");
      expect(a1.on_undetermined).toBe("REVIEW");
    },
    60_000,
  );
});

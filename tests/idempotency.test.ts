import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startHarness,
  Harness,
  KAVERI_KEY,
  NEXA_KEY,
  KAVERI_CUSTOMER_ID,
  NEXA_CUSTOMER_ID,
  sampleWithExternalId,
  countApplicationsByExternal,
  countUpstreamCalls,
  prisma,
  sleep,
} from "./helpers";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h?.stop();
});

describe("idempotency (§23)", () => {
  it(
    "replays the same key to the same application, with no second row and no second verification",
    async () => {
      const key = "idem-replay-001";
      const external = "LN-IDEM-001";
      const payload = sampleWithExternalId(external);

      const first = await h.post(payload, { apiKey: KAVERI_KEY, idempotencyKey: key });
      expect(first.status).toBe(202);
      const id = first.body.application_id;
      expect(typeof id).toBe("string");

      const second = await h.post(payload, { apiKey: KAVERI_KEY, idempotencyKey: key });
      expect(second.status).toBe(200);
      expect(second.body.application_id).toBe(id);

      const terminal = await h.waitForTerminal(id, KAVERI_KEY, 90_000);
      expect(terminal.status).not.toBe("FAILED");

      expect(await countApplicationsByExternal(external, KAVERI_CUSTOMER_ID)).toBe(1);

      const callsAfterDecision = await countUpstreamCalls(id);
      expect(callsAfterDecision).toBe(1);
      expect(terminal.upstream_calls.length).toBe(1);
      expect(terminal.upstream_calls[0].outcome).toBe("SUCCESS");

      const third = await h.post(payload, { apiKey: KAVERI_KEY, idempotencyKey: key });
      expect(third.status).toBe(200);
      expect(third.body.application_id).toBe(id);

      await sleep(3_000);
      expect(await countApplicationsByExternal(external, KAVERI_CUSTOMER_ID)).toBe(1);
      expect(await countUpstreamCalls(id)).toBe(callsAfterDecision);
      expect(
        await prisma.idempotencyRecord.count({ where: { customerId: KAVERI_CUSTOMER_ID, key } }),
      ).toBe(1);
    },
    150_000,
  );

  it(
    "rejects the same key with a different body as 409 idempotency_key_reuse",
    async () => {
      const key = "idem-reuse-002";

      const first = await h.post(sampleWithExternalId("LN-IDEM-002"), {
        apiKey: KAVERI_KEY,
        idempotencyKey: key,
      });
      expect(first.status).toBe(202);

      const different = sampleWithExternalId("LN-IDEM-002-DIFFERENT");
      different.loan.amount_inr = 999_000;

      const second = await h.post(different, { apiKey: KAVERI_KEY, idempotencyKey: key });
      expect(second.status).toBe(409);
      expect(second.body?.error).toBe("idempotency_key_reuse");

      expect(await countApplicationsByExternal("LN-IDEM-002", KAVERI_CUSTOMER_ID)).toBe(1);
      expect(await countApplicationsByExternal("LN-IDEM-002-DIFFERENT", KAVERI_CUSTOMER_ID)).toBe(0);
    },
    120_000,
  );

  it(
    "is insensitive to key ordering in the body (the hash is canonical)",
    async () => {
      const key = "idem-canonical-003";
      const external = "LN-IDEM-003";
      const payload = sampleWithExternalId(external);

      const first = await h.post(payload, { apiKey: KAVERI_KEY, idempotencyKey: key });
      expect(first.status).toBe(202);

      const reordered: any = {
        unstructured: payload.unstructured,
        loan: {
          purpose: payload.loan.purpose,
          tenure_months: payload.loan.tenure_months,
          amount_inr: payload.loan.amount_inr,
        },
        business: payload.business,
        applied_on: payload.applied_on,
        application_id_external: payload.application_id_external,
      };

      const second = await h.post(reordered, { apiKey: KAVERI_KEY, idempotencyKey: key });
      expect(second.status).toBe(200);
      expect(second.body.application_id).toBe(first.body.application_id);
      expect(await countApplicationsByExternal(external, KAVERI_CUSTOMER_ID)).toBe(1);
    },
    120_000,
  );

  it(
    "collapses two CONCURRENT identical requests into one application (the P2002 race)",
    async () => {
      const key = "idem-race-004";
      const external = "LN-IDEM-004";
      const payload = sampleWithExternalId(external);

      const [a, b] = await Promise.all([
        h.post(payload, { apiKey: KAVERI_KEY, idempotencyKey: key }),
        h.post(payload, { apiKey: KAVERI_KEY, idempotencyKey: key }),
      ]);

      expect([200, 202]).toContain(a.status);
      expect([200, 202]).toContain(b.status);
      expect(typeof a.body?.application_id).toBe("string");
      expect(b.body.application_id).toBe(a.body.application_id);

      expect(await countApplicationsByExternal(external, KAVERI_CUSTOMER_ID)).toBe(1);
      expect(
        await prisma.idempotencyRecord.count({ where: { customerId: KAVERI_CUSTOMER_ID, key } }),
      ).toBe(1);

      const decided = await h.waitForTerminal(a.body.application_id, KAVERI_KEY, 90_000);
      expect(decided.status).not.toBe("FAILED");
      expect(await countUpstreamCalls(a.body.application_id)).toBe(1);
    },
    150_000,
  );

  it(
    "scopes the key to the customer: A's 'abc' and B's 'abc' are different keys",
    async () => {
      const key = "abc";
      const external = "LN-IDEM-SHARED-KEY";
      const payload = sampleWithExternalId(external);

      const asKaveri = await h.post(payload, { apiKey: KAVERI_KEY, idempotencyKey: key });
      const asNexa = await h.post(payload, { apiKey: NEXA_KEY, idempotencyKey: key });

      expect(asKaveri.status).toBe(202);
      expect(asNexa.status).toBe(202);
      expect(asNexa.body.application_id).not.toBe(asKaveri.body.application_id);

      expect(await countApplicationsByExternal(external, KAVERI_CUSTOMER_ID)).toBe(1);
      expect(await countApplicationsByExternal(external, NEXA_CUSTOMER_ID)).toBe(1);

      expect(
        await prisma.idempotencyRecord.count({ where: { customerId: KAVERI_CUSTOMER_ID, key } }),
      ).toBe(1);
      expect(
        await prisma.idempotencyRecord.count({ where: { customerId: NEXA_CUSTOMER_ID, key } }),
      ).toBe(1);
    },
    120_000,
  );

  it(
    "creates normally when no Idempotency-Key is sent",
    async () => {
      const a = await h.post(sampleWithExternalId("LN-IDEM-NOKEY-A"), { apiKey: KAVERI_KEY });
      const b = await h.post(sampleWithExternalId("LN-IDEM-NOKEY-B"), { apiKey: KAVERI_KEY });

      expect(a.status).toBe(202);
      expect(b.status).toBe(202);
      expect(a.body.application_id).not.toBe(b.body.application_id);

      const same = sampleWithExternalId("LN-IDEM-NOKEY-SAME");
      const c = await h.post(same, { apiKey: KAVERI_KEY });
      const d = await h.post(same, { apiKey: KAVERI_KEY });
      expect(c.body.application_id).not.toBe(d.body.application_id);

      expect(await countApplicationsByExternal("LN-IDEM-NOKEY-A", KAVERI_CUSTOMER_ID)).toBe(1);
      expect(await countApplicationsByExternal("LN-IDEM-NOKEY-B", KAVERI_CUSTOMER_ID)).toBe(1);
      expect(await countApplicationsByExternal("LN-IDEM-NOKEY-SAME", KAVERI_CUSTOMER_ID)).toBe(2);

      const ids = [a, b, c, d].map((r) => r.body.application_id);
      expect(
        await prisma.idempotencyRecord.count({ where: { applicationId: { in: ids } } }),
      ).toBe(0);
    },
    120_000,
  );
});

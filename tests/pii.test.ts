import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startHarness,
  Harness,
  KAVERI_KEY,
  SAMPLE_PAN,
  SAMPLE_GSTIN,
  sample,
  postAccepted,
} from "./helpers";
import { makeLogger, maskText, maskPan, maskGstin } from "@credora/platform";

const PIPELINE_PREFIXES = ["application.", "upstream.", "extraction.", "policy.", "decision."];

function eventNameOf(line: Record<string, any>): string | null {
  for (const key of ["msg", "event", "message"]) {
    const v = line[key];
    if (typeof v === "string" && PIPELINE_PREFIXES.some((p) => v.startsWith(p))) return v;
  }
  return null;
}

let h: Harness;
let combinedLog = "";
let decided: any = null;

beforeAll(async () => {
  h = await startHarness();
  const id = await postAccepted(h, sample("A.1"), { apiKey: KAVERI_KEY });
  decided = await h.waitForTerminal(id, KAVERI_KEY, 90_000);
  await new Promise((r) => setTimeout(r, 1_500));
  combinedLog = h.allServiceLog();
  expect(combinedLog.length).toBeGreaterThan(0);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

describe("PII masking end to end (§25.1)", () => {
  it("writes neither the PAN nor the GSTIN to API or worker stdout", () => {
    const panHits = combinedLog.split("\n").filter((l) => l.includes(SAMPLE_PAN));
    const gstinHits = combinedLog.split("\n").filter((l) => l.includes(SAMPLE_GSTIN));
    expect(panHits.slice(0, 3)).toEqual([]);
    expect(gstinHits.slice(0, 3)).toEqual([]);
    expect(combinedLog).not.toContain(SAMPLE_PAN);
    expect(combinedLog).not.toContain(SAMPLE_GSTIN);
  });

  it("does not leak them through the mock upstream's log either (rule 6 says anywhere)", () => {
    const mockLog = h.mockLog();
    expect(mockLog).not.toContain(SAMPLE_GSTIN);
    expect(mockLog).not.toContain(SAMPLE_PAN);
  });

  it("still returns the real values over the API — masking is for logs, not for the customer", () => {
    expect(decided.status).toBeTruthy();
    expect(JSON.stringify(decided)).not.toContain("[REDACTED]");
  });
});

describe("correlation (§25.2)", () => {
  it("carries application_id on every pipeline log line", () => {
    const lines = h.jsonLogLines();
    expect(lines.length).toBeGreaterThan(0);

    const pipelineLines = lines.filter((l) => eventNameOf(l) !== null);
    expect(pipelineLines.length).toBeGreaterThan(0);

    const missing = pipelineLines
      .filter((l) => typeof l.application_id !== "string" || l.application_id.length === 0)
      .map((l) => eventNameOf(l));
    expect(missing).toEqual([]);
  });

  it("emits the minimum event set from §25.2", () => {
    const names = new Set(h.jsonLogLines().map(eventNameOf).filter(Boolean) as string[]);
    for (const required of [
      "application.received",
      "application.claimed",
      "upstream.attempt",
      "policy.evaluated",
      "decision.completed",
    ]) {
      expect([...names]).toContain(required);
    }
  });
});

describe("the logger itself (§25.1 unit)", () => {
  function capture() {
    const chunks: string[] = [];
    const stream = {
      write(s: string) {
        chunks.push(s);
      },
    };
    return { stream, text: () => chunks.join("") };
  }

  it("masks the PAN and GSTIN nested deep inside an object", () => {
    const c = capture();
    const log = makeLogger(c.stream as any);
    log.info(
      {
        application: {
          business: {
            identifiers: {
              nested: { deeper: { pan: SAMPLE_PAN, gstin: SAMPLE_GSTIN } },
            },
          },
        },
      },
      "deep object",
    );
    const out = c.text();
    expect(out).not.toContain(SAMPLE_PAN);
    expect(out).not.toContain(SAMPLE_GSTIN);
  });

  it("masks them inside an array, where path redaction cannot reach", () => {
    const c = capture();
    const log = makeLogger(c.stream as any);
    log.info(
      {
        issues: [
          { path: ["business", "identity"], message: `invalid value ${SAMPLE_PAN}` },
          { path: ["business"], message: `duplicate registration ${SAMPLE_GSTIN}` },
        ],
        candidates: [SAMPLE_PAN, SAMPLE_GSTIN, "harmless"],
      },
      "array",
    );
    const out = c.text();
    expect(out).not.toContain(SAMPLE_PAN);
    expect(out).not.toContain(SAMPLE_GSTIN);
    expect(out).toContain("harmless");
  });

  it("masks them inside the free-text message string", () => {
    const c = capture();
    const log = makeLogger(c.stream as any);
    log.warn(`upstream rejected ${SAMPLE_GSTIN} (pan ${SAMPLE_PAN}) with 422`);
    const out = c.text();
    expect(out).not.toContain(SAMPLE_PAN);
    expect(out).not.toContain(SAMPLE_GSTIN);
    expect(out).toContain("with 422");
  });

  it("masks a GSTIN buried in a long document-like string", () => {
    const document = [
      "GOVERNMENT OF INDIA",
      "FORM GST REG-06",
      "Registration Certificate",
      "",
      `Registration Number (GSTIN): ${SAMPLE_GSTIN}`,
      "Legal Name: Saraswati Traders Private Limited",
      `Permanent Account Number: ${SAMPLE_PAN}`,
      "Date of Incorporation: 11 August 2023",
    ].join("\n");

    const c = capture();
    const log = makeLogger(c.stream as any);
    log.error({ excerpt: document, err: new Error(`parse failed near ${SAMPLE_GSTIN}`) }, "doc");
    const out = c.text();
    expect(out).not.toContain(SAMPLE_PAN);
    expect(out).not.toContain(SAMPLE_GSTIN);
    expect(out).toContain("FORM GST REG-06");
  });

  it("masks inside an Error's message and stack, and inside a cause chain", () => {
    const c = capture();
    const log = makeLogger(c.stream as any);
    const inner = new Error(`registry lookup failed for ${SAMPLE_GSTIN}`);
    const outer = new Error(`verification failed (pan ${SAMPLE_PAN})`, { cause: inner });
    log.error({ err: outer }, "boom");
    const out = c.text();
    expect(out).not.toContain(SAMPLE_PAN);
    expect(out).not.toContain(SAMPLE_GSTIN);
  });

  it("applies the GSTIN pattern before the PAN pattern (§25.1)", () => {
    const masked = maskText(SAMPLE_GSTIN);
    expect(masked).not.toContain(SAMPLE_GSTIN);
    expect(masked).not.toContain(SAMPLE_PAN);
    expect(masked).toBe(maskGstin(SAMPLE_GSTIN));
    expect(maskText(SAMPLE_PAN)).toBe(maskPan(SAMPLE_PAN));
    expect(maskPan(SAMPLE_PAN)).toBe("AAF****K");
    expect(maskGstin(SAMPLE_GSTIN)).toBe("29****K1ZP");
  });

  it("leaves ordinary text alone", () => {
    const c = capture();
    const log = makeLogger(c.stream as any);
    log.info({ sector: "wholesale_distribution", amount: 2_500_000 }, "policy.evaluated");
    const out = c.text();
    expect(out).toContain("wholesale_distribution");
    expect(out).toContain("2500000");
  });
});

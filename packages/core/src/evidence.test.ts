import { verifyGrounding } from "./grounding";
import { describe, it, expect } from "bun:test";
import { buildEvidence } from "./evidence";
import {
  SAMPLE_A1,
  SAMPLE_A2_1,
  SAMPLE_A2_2,
  SAMPLE_A2_3,
  SAMPLE_A2_4,
  UPSTREAM_A1,
  SAMPLES,
} from "./fixtures";
import type { ApplicationPayload, Concern, ExtractionEnvelope, UpstreamResult } from "./types";
import type { Extraction } from "./extraction-schema";

const UPSTREAM = UPSTREAM_A1 as unknown as UpstreamResult;

const iso = (d: unknown) => (d as Date).toISOString().slice(0, 10);
const codes = (cs: Concern[]) => cs.map((c) => c.code);
const byCode = (cs: Concern[], code: string) => cs.filter((c) => c.code === code);

function envelope(extraction: Extraction, concerns: Concern[] = []): ExtractionEnvelope {
  return {
    available: true,
    reason: null,
    extraction,
    fields: [],
    ungrounded: [],
    concerns,
    model: "gemini-test",
    cached: false,
  };
}

function extractionA1(): Extraction {
  return {
    entity_name: {
      value: "Saraswati Traders Private Limited",
      quote: "Saraswati Traders Private Limited",
    },
    incorporation_date: {
      value: "2023-08-11",
      quote: "Date of Incorporation: 11 August 2023",
    },
    registration_number: {
      value: "29AAFCS4321K1ZP",
      quote: "CIN: U51909KA2023PTC145622",
    },
    turnover_statement: {
      value: "Rs. 1.45 crore",
      quote: "Bank statements looked consistent with the turnover claimed",
    },
    registered_address: {
      value: "No. 42, 3rd Cross, Peenya Industrial Area, Bengaluru 560058",
      quote:
        "Registered Office: No. 42, 3rd Cross, Peenya Industrial Area, Bengaluru 560058",
    },
    operating_address: {
      value: "No. 42, 3rd Cross, Peenya Industrial Area, Bengaluru 560058",
      quote:
        "Registered Office: No. 42, 3rd Cross, Peenya Industrial Area, Bengaluru 560058",
    },
    sectors: [
      {
        value: "Wholesale of electronic goods",
        quote: "Warehouse operational",
      },
    ],
    undisclosed_units: [
      {
        value: "Second godown in Tumkur",
        quote:
          "Mentioned a second unit in Tumkur that isn't on the GST record.",
      },
    ],
    concerns: [],
    instruction_attempt: false,
  };
}

function extractionA23(): Extraction {
  const base = extractionA1();
  return {
    ...base,
    sectors: [
      ...base.sectors,
      { value: "Trading in virtual digital assets", quote: "Trading in virtual digital assets" },
      { value: "Import of consumer electronics", quote: "Import of consumer electronics" },
    ],
  };
}

function extractionEmpty(): Extraction {
  return {
    entity_name: null,
    incorporation_date: null,
    registration_number: null,
    turnover_statement: null,
    registered_address: null,
    operating_address: null,
    sectors: [],
    undisclosed_units: [],
    concerns: [],
    instruction_attempt: false,
  };
}

function run(payload: ApplicationPayload, up: UpstreamResult | null, env: ExtractionEnvelope | null) {
  return buildEvidence({ payload, upstream: up, extraction: env });
}

describe("13.1 fact table — A.1, upstream healthy, model healthy", () => {
  const { evidence } = run(SAMPLE_A1, UPSTREAM, envelope(extractionA1()));

  it("resolves the five payload facts with JSON-path provenance", () => {
    expect(iso(evidence.applied_on.value)).toBe("2026-02-20");
    expect(evidence.applied_on).toMatchObject({ available: true, source: "payload", provenance: "applied_on" });

    expect(evidence.loan_amount.value).toBe(2_500_000);
    expect(evidence.loan_amount.provenance).toBe("loan.amount_inr");
    expect(evidence.loan_amount.source).toBe("payload");

    expect(evidence.declared_turnover.value).toBe(14_500_000);
    expect(evidence.declared_turnover.provenance).toBe("business.declared_annual_turnover_inr");

    expect(evidence.payload_registered_address.value).toBe(
      "No. 42, 3rd Cross, Peenya Industrial Area, Bengaluru 560058",
    );
    expect(evidence.payload_registered_address.provenance).toBe("business.registered_address");

    expect(evidence.declared_sectors.value).toEqual(["wholesale_distribution"]);
    expect(evidence.declared_sectors.provenance).toBe("business.sector");
  });

  it("resolves the upstream facts with upstream:<field> provenance", () => {
    expect(evidence.gstin_status.value).toBe("ACTIVE");
    expect(evidence.gstin_status.provenance).toBe("upstream:status");
    expect(evidence.gstin_status.source).toBe("upstream");

    expect(iso(evidence.last_return_filed.value)).toBe("2026-01-10");
    expect(evidence.last_return_filed.provenance).toBe("upstream:last_return_filed_on");

    expect(evidence.evidenced_turnover.value).toBe(10_200_000);
    expect(evidence.evidenced_turnover.provenance).toBe("upstream:filings_annual_turnover_inr");

    expect(evidence.upstream_registered_address.value).toBe(
      "No. 42, 3rd Cross, Peenya Industrial Area, Bengaluru 560058",
    );
    expect(evidence.upstream_registered_address.provenance).toBe("upstream:registered_address");
  });

  it("takes incorporation_date from the registry, not the document", () => {
    expect(iso(evidence.incorporation_date.value)).toBe("2023-08-11");
    expect(evidence.incorporation_date.source).toBe("upstream");
    expect(evidence.incorporation_date.provenance).toBe("upstream:incorporation_date");
  });

  it("resolves the extraction facts with the verbatim quote as provenance", () => {
    expect(evidence.operating_address.source).toBe("extraction");
    expect(evidence.operating_address.provenance).toContain("Registered Office");

    expect(evidence.undisclosed_units.value).toEqual(["Second godown in Tumkur"]);
    expect(evidence.undisclosed_units.source).toBe("extraction");
    expect(evidence.undisclosed_units.provenance).toContain("second unit in Tumkur");

    expect(evidence.extracted_sectors.value).toEqual(["wholesale_distribution"]);
    expect(evidence.extracted_sectors.provenance).toContain("Warehouse operational");
  });

  it("derives verification_succeeded and all_sectors", () => {
    expect(evidence.verification_succeeded.value).toBe(true);
    expect(evidence.verification_succeeded.source).toBe("derived");
    expect(evidence.all_sectors.value).toEqual(["wholesale_distribution"]);
    expect(evidence.all_sectors.available).toBe(true);
  });

  it("produces all fifteen keys and every fact carries the four Fact members", () => {
    expect(Object.keys(evidence).sort()).toEqual(
      [
        "all_sectors",
        "applied_on",
        "declared_sectors",
        "declared_turnover",
        "evidenced_turnover",
        "extracted_sectors",
        "gstin_status",
        "incorporation_date",
        "last_return_filed",
        "loan_amount",
        "operating_address",
        "payload_registered_address",
        "undisclosed_units",
        "upstream_registered_address",
        "verification_succeeded",
      ],
    );
    for (const f of Object.values(evidence)) {
      expect(Object.keys(f).sort()).toEqual(["available", "provenance", "source", "value"]);
    }
  });

  it("drops an ungrounded field instead of letting it become a fact", () => {
    const tampered = extractionA1();
    tampered.operating_address = {
      value: "Plot 9, Hosur Road, Bengaluru 560068",
      quote: "Operating premises: Plot 9, Hosur Road, Bengaluru 560068",
    };
    const { evidence: ev } = run(SAMPLE_A1, UPSTREAM, envelope(tampered));
    expect(ev.operating_address.available).toBe(false);
    expect(ev.operating_address.value).toBeNull();
  });
});

describe("A.1 — SOURCE_CONTRADICTION from the field agent's note", () => {
  const { concerns } = run(SAMPLE_A1, UPSTREAM, envelope(extractionA1()));

  it("raises SOURCE_CONTRADICTION quoting 'running since 2021' against registry 2023", () => {
    const found = byCode(concerns, "SOURCE_CONTRADICTION");
    expect(found.length).toBe(1);
    expect(found[0]!.quote).toContain("running since 2021");
    expect(found[0]!.detail).toContain("2021");
    expect(found[0]!.detail).toContain("2023");
  });

  it("does not raise TURNOVER_CONTRADICTION — the document says exactly 1.45 crore", () => {
    expect(codes(concerns)).not.toContain("TURNOVER_CONTRADICTION");
  });

  it("does not raise PROMPT_INJECTION_ATTEMPT or NO_UNSTRUCTURED_MATERIAL", () => {
    expect(codes(concerns)).not.toContain("PROMPT_INJECTION_ATTEMPT");
    expect(codes(concerns)).not.toContain("NO_UNSTRUCTURED_MATERIAL");
  });

  it("never turns the agent's 2021 claim into the incorporation_date fact", () => {
    const { evidence } = run(SAMPLE_A1, UPSTREAM, envelope(extractionA1()));
    expect(iso(evidence.incorporation_date.value)).toBe("2023-08-11");
  });
});

describe("A.2.1 — PROMPT_INJECTION_ATTEMPT", () => {
  const env = envelope(extractionA1());
  const { evidence, concerns } = run(SAMPLE_A2_1, UPSTREAM, env);

  it("fires even though the model's instruction_attempt flag is false", () => {
    expect(env.extraction!.instruction_attempt).toBe(false);
    const found = byCode(concerns, "PROMPT_INJECTION_ATTEMPT");
    expect(found.length).toBe(1);
    expect(found[0]!.quote.toLowerCase()).toContain("note to automated reviewer");
    expect(found[0]!.detail).toContain("does not change the outcome");
  });

  it("changes no fact — the evidence is identical to A.1's", () => {
    const base = run(SAMPLE_A1, UPSTREAM, envelope(extractionA1())).evidence;
    expect(evidence).toEqual(base);
  });

  it("also fires when only the model flags it and the scanner sees nothing", () => {
    const flagged = extractionA1();
    flagged.instruction_attempt = true;
    const out = run(SAMPLE_A1, UPSTREAM, envelope(flagged));
    expect(codes(out.concerns)).toContain("PROMPT_INJECTION_ATTEMPT");
  });
});

describe("A.2.2 — TURNOVER_CONTRADICTION", () => {
  const { concerns, evidence } = run(SAMPLE_A2_2, UPSTREAM, envelope(extractionA1()));

  it("annualises '45 lakh a month' to 5,40,00,000 against a declared 1,45,00,000", () => {
    const found = byCode(concerns, "TURNOVER_CONTRADICTION");
    expect(found.length).toBe(1);
    expect(found[0]!.detail).toContain("5,40,00,000");
    expect(found[0]!.detail).toContain("1,45,00,000");
    expect(found[0]!.quote).toContain("45 lakh a month");
  });

  it("leaves declared_turnover untouched — a concern is not a fact", () => {
    expect(evidence.declared_turnover.value).toBe(14_500_000);
    expect(evidence.evidenced_turnover.value).toBe(10_200_000);
  });

  it("fires identically when the model picks the note's figure instead", () => {
    const alt = extractionA1();
    alt.turnover_statement = {
      value: "45 lakh a month",
      quote: "Owner quoted turnover at around 45 lakh a month",
    };
    const out = run(SAMPLE_A2_2, UPSTREAM, envelope(alt));
    const found = byCode(out.concerns, "TURNOVER_CONTRADICTION");
    expect(found.length).toBe(1);
    expect(found[0]!.detail).toContain("5,40,00,000");
  });

  it("does not mistake the loan amount for a turnover figure", () => {
    const out = run(SAMPLE_A1, UPSTREAM, envelope(extractionA1()));
    for (const c of byCode(out.concerns, "TURNOVER_CONTRADICTION")) {
      expect(c.detail).not.toContain("2,500,000");
    }
    expect(codes(out.concerns)).not.toContain("TURNOVER_CONTRADICTION");
  });
});

describe("A.2.3 — the excluded sector hides in the document", () => {
  const { evidence } = run(SAMPLE_A2_3, UPSTREAM, envelope(extractionA23()));

  it("all_sectors contains crypto_trading from the extracted sectors", () => {
    expect(evidence.extracted_sectors.value).toContain("crypto_trading");
    expect(evidence.all_sectors.value).toContain("crypto_trading");
  });

  it("all_sectors is the deduped union of declared and extracted", () => {
    expect(evidence.all_sectors.value).toEqual([
      "wholesale_distribution",
      "crypto_trading",
      "import_export",
    ]);
    expect(evidence.declared_sectors.value).toEqual(["wholesale_distribution"]);
  });
});

describe("A.2.4 — nothing to read", () => {
  const { evidence, concerns } = run(SAMPLE_A2_4, UPSTREAM, envelope(extractionEmpty()));

  it("raises NO_UNSTRUCTURED_MATERIAL", () => {
    expect(codes(concerns)).toContain("NO_UNSTRUCTURED_MATERIAL");
  });

  it("undisclosed_units is AVAILABLE and EMPTY, so A6/B6 can PASS", () => {
    expect(evidence.undisclosed_units.available).toBe(true);
    expect(evidence.undisclosed_units.value).toEqual([]);
  });

  it("operating_address is UNAVAILABLE — absence of a finding is not a finding", () => {
    expect(evidence.operating_address.available).toBe(false);
    expect(evidence.operating_address.value).toBeNull();
    expect(evidence.operating_address.source).toBeNull();
  });

  it("extracted_sectors is available and empty; all_sectors falls back to declared", () => {
    expect(evidence.extracted_sectors.available).toBe(true);
    expect(evidence.extracted_sectors.value).toEqual([]);
    expect(evidence.all_sectors.value).toEqual(["wholesale_distribution"]);
  });

  it("the upstream-backed facts still resolve normally", () => {
    expect(iso(evidence.incorporation_date.value)).toBe("2023-08-11");
    expect(evidence.gstin_status.value).toBe("ACTIVE");
    expect(evidence.evidenced_turnover.value).toBe(10_200_000);
  });
});

describe("upstream null — verification failed entirely", () => {
  const { evidence } = run(SAMPLE_A1, null, null);

  it("marks every upstream-backed fact unavailable", () => {
    for (const key of [
      "gstin_status",
      "incorporation_date",
      "last_return_filed",
      "evidenced_turnover",
      "upstream_registered_address",
    ]) {
      expect(evidence[key]!.available).toBe(false);
      expect(evidence[key]!.value).toBeNull();
      expect(evidence[key]!.provenance).toBeNull();
    }
  });

  it("verification_succeeded is AVAILABLE and false — that is a finding, not a gap", () => {
    expect(evidence.verification_succeeded.available).toBe(true);
    expect(evidence.verification_succeeded.value).toBe(false);
    expect(evidence.verification_succeeded.source).toBe("derived");
  });

  it("all_sectors is still available, as the declared set", () => {
    expect(evidence.all_sectors.available).toBe(true);
    expect(evidence.all_sectors.value).toEqual(["wholesale_distribution"]);
  });

  it("payload facts are unaffected", () => {
    expect(evidence.loan_amount.value).toBe(2_500_000);
    expect(evidence.declared_turnover.value).toBe(14_500_000);
    expect(iso(evidence.applied_on.value)).toBe("2026-02-20");
  });

  it("does NOT fall back to the document's date when verification failed entirely", () => {
    const { evidence: ev } = run(SAMPLE_A1, null, envelope(extractionA1()));
    expect(ev.incorporation_date.available).toBe(false);
    expect(ev.incorporation_date.value).toBeNull();
    expect(ev.incorporation_date.source).toBeNull();
  });

  it("DOES fall back when the registry answered but omitted incorporation_date", () => {
    const partial = { ...UPSTREAM_A1, incorporation_date: null } as any;
    const { evidence: ev } = run(SAMPLE_A1, partial, envelope(extractionA1()));
    expect(ev.incorporation_date.available).toBe(true);
    expect(iso(ev.incorporation_date.value)).toBe("2023-08-11");
    expect(ev.incorporation_date.source).toBe("extraction");
    expect(ev.incorporation_date.provenance).toBe("Date of Incorporation: 11 August 2023");
  });

  it("does not fall back to an unparseable document date", () => {
    const vague = extractionA1();
    vague.incorporation_date = {
      value: "about two years back",
      quote: "they moved into the current line about two years back",
    };
    const { evidence: ev } = run(SAMPLE_A1, null, envelope(vague));
    expect(ev.incorporation_date.available).toBe(false);
  });

  it("does not fall back to a raw, non-ISO date the model could not normalise", () => {
    const raw = extractionA1();
    raw.incorporation_date = {
      value: "11 August 2023",
      quote: "Date of Incorporation: 11 August 2023",
    };
    const { evidence: ev } = run(SAMPLE_A1, null, envelope(raw));
    expect(ev.incorporation_date.available).toBe(false);
    expect(ev.incorporation_date.value).toBeNull();
  });
});

describe("model unavailable — the envelope reports available: false", () => {
  const down: ExtractionEnvelope = {
    available: false,
    reason: "MODEL_OUTAGE_SIMULATED",
    extraction: null,
    fields: [],
    ungrounded: [],
    concerns: [],
    model: null,
    cached: false,
  };
  const { evidence, concerns } = run(SAMPLE_A1, UPSTREAM, down);

  it("marks every extraction-backed fact unavailable, including undisclosed_units", () => {
    expect(evidence.operating_address.available).toBe(false);
    expect(evidence.undisclosed_units.available).toBe(false);
    expect(evidence.extracted_sectors.available).toBe(false);
  });

  it("leaves the upstream facts and all_sectors intact", () => {
    expect(iso(evidence.incorporation_date.value)).toBe("2023-08-11");
    expect(evidence.incorporation_date.source).toBe("upstream");
    expect(evidence.all_sectors.value).toEqual(["wholesale_distribution"]);
  });

  it("still scans the raw text for contradictions and injection", () => {
    expect(codes(concerns)).toContain("SOURCE_CONTRADICTION");
    const a21 = run(SAMPLE_A2_1, UPSTREAM, down);
    expect(codes(a21.concerns)).toContain("PROMPT_INJECTION_ATTEMPT");
    const a22 = run(SAMPLE_A2_2, UPSTREAM, down);
    expect(codes(a22.concerns)).toContain("TURNOVER_CONTRADICTION");
  });
});

describe("carried concerns", () => {
  it("carries the extractor's own concerns through, deduped by code + quote", () => {
    const carried: Concern[] = [
      { code: "SOURCE_CONTRADICTION", detail: "model raised this", quote: "the business has been running since 2021" },
      { code: "MODEL_NOTE", detail: "ledger shown on screen only", quote: "Ledgers were shown on screen only" },
      { code: "MODEL_NOTE", detail: "duplicate", quote: "Ledgers were shown on screen only" },
    ];
    const { concerns } = run(SAMPLE_A1, UPSTREAM, envelope(extractionA1(), carried));
    expect(byCode(concerns, "MODEL_NOTE").length).toBe(1);
    expect(byCode(concerns, "SOURCE_CONTRADICTION").length).toBe(2);
  });

  it("is deterministic — the same inputs give the same concerns in the same order", () => {
    const a = run(SAMPLE_A2_2, UPSTREAM, envelope(extractionA1()));
    const b = run(SAMPLE_A2_2, UPSTREAM, envelope(extractionA1()));
    expect(a).toEqual(b);
  });
});

describe("concern quotes are always grounded in the source", () => {
  it("TURNOVER_CONTRADICTION quotes the grounded quote, not the model's value", () => {
    const ex = extractionA1();
    ex.turnover_statement = {
      value: "Rs 99 crore per annum",
      quote: "Bank statements looked consistent with the turnover claimed",
    };
    const { concerns } = run(SAMPLE_A1, UPSTREAM, envelope(ex));
    const found = concerns.filter((c) => c.code === "TURNOVER_CONTRADICTION");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]!.detail).toContain("99,00,00,000");
    const source =
      SAMPLE_A1.unstructured.field_agent_note + "\n" + SAMPLE_A1.unstructured.document_text;
    for (const c of concerns) {
      if (!c.quote) continue;
      expect(verifyGrounding(c.quote, source)).toBe(true);
    }
  });

  it("holds for every fixture: no concern ever quotes text absent from the source", () => {
    for (const [name, sample] of Object.entries(SAMPLES)) {
      const src = sample.unstructured.field_agent_note + "\n" + sample.unstructured.document_text;
      const { concerns } = run(sample, UPSTREAM, envelope(extractionA1()));
      for (const c of concerns) {
        if (!c.quote || c.quote.length < 8) continue;
        expect(
          verifyGrounding(c.quote, src),
          `${name}: concern ${c.code} quoted text not present in the source: ${c.quote}`,
        ).toBe(true);
      }
    }
  });
});

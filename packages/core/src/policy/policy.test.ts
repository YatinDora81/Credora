import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SAMPLE_A1, SAMPLE_E1, UPSTREAM_A1, UPSTREAM_E1 } from "../fixtures";
import type { ClauseResult, ClauseResultKind, Evidence, Fact, FactSource } from "../types";
import { aggregate } from "./aggregate";
import { compareAddresses } from "./checks";
import { evaluate } from "./evaluate";
import { canonicalStringify, evidenceHash, policyHash, sha256Hex } from "./hash";
import { listPolicies, loadPolicy, policyExists, validateAllPolicies } from "./loader";

function fact<T>(value: T, source: FactSource, provenance: string): Fact<T> {
  return { value, available: true, source, provenance };
}

const UNAVAILABLE: Fact = { value: null, available: false, source: null, provenance: null };

const OPERATING_ADDRESS =
  "No. 42, 3rd Cross, Peenya Industrial Area, Bengaluru 560058, Karnataka";
const TUMKUR_QUOTE =
  "They also operate a second godown in Tumkur which he says is not on the GST registration yet.";

function evidenceA1(overrides: Evidence = {}): Evidence {
  return {
    applied_on: fact(SAMPLE_A1.applied_on, "payload", "applied_on"),
    loan_amount: fact(SAMPLE_A1.loan.amount_inr, "payload", "loan.amount_inr"),
    declared_turnover: fact(
      SAMPLE_A1.business.declared_annual_turnover_inr,
      "payload",
      "business.declared_annual_turnover_inr",
    ),
    payload_registered_address: fact(
      SAMPLE_A1.business.registered_address,
      "payload",
      "business.registered_address",
    ),
    declared_sectors: fact(["wholesale_distribution"], "payload", "business.sector"),
    gstin_status: fact(UPSTREAM_A1.status, "upstream", "upstream:status"),
    incorporation_date: fact(
      UPSTREAM_A1.incorporation_date,
      "upstream",
      "upstream:incorporation_date",
    ),
    last_return_filed: fact(
      UPSTREAM_A1.last_return_filed_on,
      "upstream",
      "upstream:last_return_filed_on",
    ),
    evidenced_turnover: fact(
      UPSTREAM_A1.filings_annual_turnover_inr,
      "upstream",
      "upstream:filings_annual_turnover_inr",
    ),
    upstream_registered_address: fact(
      UPSTREAM_A1.registered_address,
      "upstream",
      "upstream:registered_address",
    ),
    operating_address: fact(
      OPERATING_ADDRESS,
      "extraction",
      "Principal Place of Business: No. 42, 3rd Cross, Peenya Industrial Area, Bengaluru 560058, Karnataka",
    ),
    undisclosed_units: fact(["Tumkur"], "extraction", TUMKUR_QUOTE),
    extracted_sectors: fact(
      ["wholesale_distribution"],
      "extraction",
      "Nature of Business Activities: Wholesale of electronic goods",
    ),
    verification_succeeded: fact(true, "derived", "derived:upstream_responded"),
    all_sectors: fact(["wholesale_distribution"], "derived", "derived:all_sectors"),
    ...overrides,
  };
}

function evidenceUpstreamDown(): Evidence {
  return evidenceA1({
    gstin_status: UNAVAILABLE,
    incorporation_date: UNAVAILABLE,
    last_return_filed: UNAVAILABLE,
    evidenced_turnover: UNAVAILABLE,
    upstream_registered_address: UNAVAILABLE,
    verification_succeeded: fact(false, "derived", "derived:upstream_did_not_respond"),
  });
}

function evidenceModelOutage(): Evidence {
  return evidenceA1({
    operating_address: UNAVAILABLE,
    undisclosed_units: UNAVAILABLE,
    extracted_sectors: UNAVAILABLE,
  });
}

function byId(results: ClauseResult[]): Record<string, ClauseResult> {
  return Object.fromEntries(results.map((r) => [r.clause_id, r]));
}

function decide(evidence: Evidence, customer: string, version: string) {
  const policy = loadPolicy(customer, version);
  const results = evaluate(evidence, policy);
  return { policy, results, byId: byId(results), summary: aggregate(results, policy) };
}

function expectResults(
  results: ClauseResult[],
  expected: Record<string, ClauseResultKind>,
): void {
  const actual: Record<string, ClauseResultKind> = Object.fromEntries(
    results.map((r) => [r.clause_id, r.result]),
  );
  expect(actual).toEqual(expected);
}

const KAVERI_31 = ["kaveri_capital", "3.1"] as const;
const KAVERI_32 = ["kaveri_capital", "3.2"] as const;
const NEXA_14 = ["nexa_finserv", "1.4"] as const;
const PALAR_11 = ["palar_msme", "1.1"] as const;
const TAPTI_20 = ["tapti_tradefin", "2.0"] as const;
const VAMSADHARA_10 = ["vamsadhara_coop", "1.0"] as const;
const ALL_POLICIES = [KAVERI_31, KAVERI_32, NEXA_14, PALAR_11, TAPTI_20, VAMSADHARA_10] as const;

describe("loader", () => {
  test("lists the six shipped policies", () => {
    expect(listPolicies()).toEqual([
      { customer: "kaveri_capital", version: "3.1" },
      { customer: "kaveri_capital", version: "3.2" },
      { customer: "nexa_finserv", version: "1.4" },
      { customer: "palar_msme", version: "1.1" },
      { customer: "tapti_tradefin", version: "2.0" },
      { customer: "vamsadhara_coop", version: "1.0" },
    ]);
  });

  test("policyExists", () => {
    expect(policyExists("kaveri_capital", "3.1")).toBe(true);
    expect(policyExists("kaveri_capital", "9.9")).toBe(false);
    expect(policyExists("no_such_customer", "1.0")).toBe(false);
  });

  test("validateAllPolicies loads all six without throwing", () => {
    expect(validateAllPolicies().map((p) => `${p.customer}@${p.version}`)).toEqual([
      "kaveri_capital@3.1",
      "kaveri_capital@3.2",
      "nexa_finserv@1.4",
      "palar_msme@1.1",
      "tapti_tradefin@2.0",
      "vamsadhara_coop@1.0",
    ]);
  });

  test("kaveri 3.1 is transcribed verbatim", () => {
    const p = loadPolicy(...KAVERI_31);
    expect(p.customer).toBe("kaveri_capital");
    expect(p.version).toBe("3.1");
    expect(p.cap_undetermined_at).toBe("REVIEW");
    expect(p.clauses.map((c) => c.id)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]);
    expect(p.clauses[0]!.text).toBe(
      "Business must be incorporated at least 36 months before application date.",
    );
    expect(p.clauses[0]!.params).toEqual({ months: 36 });
    expect(p.clauses[0]!.requires).toEqual(["incorporation_date", "applied_on"]);
    expect(p.clauses[0]!.on_fail).toBe("REJECT");
    expect(p.clauses[0]!.on_undetermined).toBe("REVIEW");
    expect(p.clauses[7]!.params).toEqual({
      excluded: ["crypto_trading", "gambling", "unregistered_lending"],
    });
  });

  test("kaveri 3.2 resolves extends: only A1 changes, order and cap are inherited", () => {
    const parent = loadPolicy(...KAVERI_31);
    const child = loadPolicy(...KAVERI_32);

    expect(child.customer).toBe("kaveri_capital");
    expect(child.version).toBe("3.2");
    expect(child.extends).toBe("3.1");
    expect(child.cap_undetermined_at).toBe("REVIEW");
    expect(child.clauses.map((c) => c.id)).toEqual(parent.clauses.map((c) => c.id));

    expect(child.clauses[0]!.text).toBe(
      "Business must be incorporated at least 24 months before application date.",
    );
    expect(child.clauses[0]!.params).toEqual({ months: 24 });
    expect(child.clauses[0]!.check).toBe("min_age_months");
    expect(child.clauses[0]!.requires).toEqual(["incorporation_date", "applied_on"]);
    expect(child.clauses[0]!.on_fail).toBe("REJECT");
    expect(child.clauses[0]!.on_undetermined).toBe("REVIEW");

    expect(child.clauses.slice(1)).toEqual(parent.clauses.slice(1));
  });

  test("nexa 1.4 is transcribed verbatim", () => {
    const p = loadPolicy(...NEXA_14);
    expect(p.mark_degraded_only).toBe(true);
    expect(p.cap_undetermined_at).toBeUndefined();
    expect(p.clauses.map((c) => c.id)).toEqual(["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"]);
    expect(p.clauses[2]!.applies_when).toEqual({ check: "max_age_months", params: { months: 24 } });
    expect(p.clauses.map((c) => c.on_undetermined)).toEqual(Array(8).fill("APPROVE"));
    expect(p.clauses[7]!.params).toEqual({ excluded: ["gambling", "unregistered_lending"] });
  });

  test("loadPolicy is cached by key@version", () => {
    expect(loadPolicy(...KAVERI_31)).toBe(loadPolicy(...KAVERI_31));
  });

  test("a missing policy throws", () => {
    expect(() => loadPolicy("kaveri_capital", "9.9")).toThrow(/Policy not found/);
  });

  describe("validation throws at load", () => {
    const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "policies");

    function withTempPolicy(version: string, yaml: string, assertion: () => void): void {
      const file = join(DIR, `@${version}.yaml`);
      writeFileSync(file, yaml, "utf8");
      try {
        assertion();
      } finally {
        rmSync(file, { force: true });
      }
    }

    const clause = (body: string) => `customer: temp_test\nversion: "0"\nclauses:\n${body}`;

    test("unknown check names the clause and the check", () => {
      withTempPolicy(
        "90",
        clause(
          `  - id: A1\n    text: "t"\n    check: no_such_check\n    params: {}\n    requires: [applied_on]\n    on_fail: REJECT\n    on_undetermined: REVIEW\n`,
        ),
        () => {
          expect(() => loadPolicy("", "90")).toThrow(/A1/);
          expect(() => loadPolicy("", "90")).toThrow(/no_such_check/);
        },
      );
    });

    test("empty requires throws", () => {
      withTempPolicy(
        "91",
        clause(
          `  - id: A1\n    text: "t"\n    check: gstin_active\n    params: {}\n    requires: []\n    on_fail: REJECT\n    on_undetermined: REVIEW\n`,
        ),
        () => expect(() => loadPolicy("", "91")).toThrow(/empty requires list/),
      );
    });

    test("an out-of-range on_fail throws", () => {
      withTempPolicy(
        "92",
        clause(
          `  - id: A1\n    text: "t"\n    check: gstin_active\n    params: {}\n    requires: [gstin_status]\n    on_fail: ESCALATE\n    on_undetermined: REVIEW\n`,
        ),
        () => expect(() => loadPolicy("", "92")).toThrow(/invalid on_fail "ESCALATE"/),
      );
    });

    test("an out-of-range on_undetermined throws", () => {
      withTempPolicy(
        "93",
        clause(
          `  - id: A1\n    text: "t"\n    check: gstin_active\n    params: {}\n    requires: [gstin_status]\n    on_fail: REJECT\n    on_undetermined: MAYBE\n`,
        ),
        () => expect(() => loadPolicy("", "93")).toThrow(/invalid on_undetermined "MAYBE"/),
      );
    });

    test("an unknown applies_when check throws", () => {
      withTempPolicy(
        "94",
        clause(
          `  - id: A1\n    text: "t"\n    check: gstin_active\n    params: {}\n    requires: [gstin_status]\n    applies_when:\n      check: not_a_gate\n      params: {}\n    on_fail: REJECT\n    on_undetermined: REVIEW\n`,
        ),
        () => expect(() => loadPolicy("", "94")).toThrow(/applies_when names unknown check "not_a_gate"/),
      );
    });
  });
});

describe("section 18: sample A.1, upstream healthy, model healthy", () => {
  test("Kaveri 3.1 -> REJECTED", () => {
    const { results, byId: c, summary } = decide(evidenceA1(), ...KAVERI_31);

    expect(results.map((r) => r.clause_id)).toEqual([
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
      "A6",
      "A7",
      "A8",
    ]);
    expectResults(results, {
      A1: "FAIL",
      A2: "PASS",
      A3: "FAIL",
      A4: "PASS",
      A5: "PASS",
      A6: "FAIL",
      A7: "PASS",
      A8: "PASS",
    });

    expect(c.A1!.outcome).toBe("REJECT");
    expect(c.A3!.outcome).toBe("REVIEW");
    expect(c.A6!.outcome).toBe("REVIEW");
    expect(c.A2!.outcome).toBe("APPROVE");
    expect(c.A4!.outcome).toBe("APPROVE");

    expect(summary.outcome).toBe("REJECTED");
    expect(summary.degraded).toBe(false);
    expect(summary.degraded_reasons).toEqual([]);
  });

  test("Kaveri 3.2 -> REVIEW (A1 passes at 24 months)", () => {
    const { results, byId: c, summary } = decide(evidenceA1(), ...KAVERI_32);

    expectResults(results, {
      A1: "PASS",
      A2: "PASS",
      A3: "FAIL",
      A4: "PASS",
      A5: "PASS",
      A6: "FAIL",
      A7: "PASS",
      A8: "PASS",
    });
    expect(c.A1!.explanation).toBe(
      "Incorporated 2023-08-11; 30 months before application date 2026-02-20; policy requires at least 24.",
    );
    expect(summary.outcome).toBe("REVIEW");
    expect(summary.degraded).toBe(false);
  });

  test("Nexa 1.4 -> APPROVED (B3 not applicable, B6 passes)", () => {
    const { results, byId: c, summary } = decide(evidenceA1(), ...NEXA_14);

    expect(results.map((r) => r.clause_id)).toEqual([
      "B1",
      "B2",
      "B3",
      "B4",
      "B5",
      "B6",
      "B7",
      "B8",
    ]);
    expectResults(results, {
      B1: "PASS",
      B2: "PASS",
      B3: "NOT_APPLICABLE",
      B4: "PASS",
      B5: "PASS",
      B6: "PASS",
      B7: "PASS",
      B8: "PASS",
    });

    expect(c.B3!.outcome).toBe("APPROVE");
    expect(c.B3!.evidence_refs).toEqual([]);
    expect(c.B3!.explanation).toBe(
      "Clause does not apply: Incorporated 2023-08-11; 30 months before application date 2026-02-20; policy applies only below 24.",
    );
    expect(c.B6!.explanation).toContain("overstatement 42.2%");
    expect(c.B4!.explanation).toContain("policy allows up to 40%");

    expect(summary.outcome).toBe("APPROVED");
    expect(summary.degraded).toBe(false);
  });

  test("detail strings carry the numbers actually compared", () => {
    const { byId: c } = decide(evidenceA1(), ...KAVERI_31);

    expect(c.A1!.explanation).toBe(
      "Incorporated 2023-08-11; 30 months before application date 2026-02-20; policy requires at least 36.",
    );
    expect(c.A2!.explanation).toBe(
      "GSTIN status ACTIVE; last return filed 2026-01-10, 41 days before application date 2026-02-20; policy requires status ACTIVE and filing within 90 days.",
    );
    expect(c.A3!.explanation).toBe(
      "Declared 1,45,00,000 vs evidenced 1,02,00,000; variance 42.2% of evidenced; policy allows up to 40%.",
    );
    expect(c.A4!.explanation).toBe(
      "Loan 25,00,000 is 24.5% of verified turnover 1,02,00,000; policy allows up to 25%.",
    );
    expect(c.A6!.explanation).toBe("1 undisclosed unit noted: Tumkur.");
    expect(c.A5!.explanation).toContain("No address mismatch.");
    expect(c.A8!.explanation).toBe(
      "Sectors assessed: wholesale_distribution. None excluded by policy (crypto_trading, gambling, unregistered_lending).",
    );
  });

  test("evidence_refs are the provenance strings of the facts used", () => {
    const { byId: c } = decide(evidenceA1(), ...KAVERI_31);
    expect(c.A1!.evidence_refs).toEqual(["upstream:incorporation_date", "applied_on"]);
    expect(c.A4!.evidence_refs).toEqual([
      "loan.amount_inr",
      "upstream:filings_annual_turnover_inr",
    ]);
    expect(c.A6!.evidence_refs).toEqual([TUMKUR_QUOTE]);
  });
});

describe("A.2.3: all_sectors contains crypto_trading", () => {
  function evidenceCrypto(): Evidence {
    return evidenceA1({
      extracted_sectors: fact(
        ["wholesale_distribution", "crypto_trading", "import_export", "electronics"],
        "extraction",
        "Nature of Business Activities: Wholesale of electronic goods; Trading in virtual digital assets; Import of consumer electronics",
      ),
      all_sectors: fact(
        ["wholesale_distribution", "crypto_trading"],
        "derived",
        "derived:all_sectors",
      ),
    });
  }

  test("Kaveri 3.1 -> REJECTED via A8 FAIL", () => {
    const { byId: c, summary } = decide(evidenceCrypto(), ...KAVERI_31);
    expect(c.A8!.result).toBe("FAIL");
    expect(c.A8!.outcome).toBe("REJECT");
    expect(c.A8!.explanation).toBe(
      "Sectors assessed: wholesale_distribution, crypto_trading. Excluded by policy: crypto_trading.",
    );
    expect(summary.outcome).toBe("REJECTED");
  });

  test("Kaveri 3.2 -> REJECTED via A8 even though A1 now passes", () => {
    const { byId: c, summary } = decide(evidenceCrypto(), ...KAVERI_32);
    expect(c.A1!.result).toBe("PASS");
    expect(c.A8!.result).toBe("FAIL");
    expect(summary.outcome).toBe("REJECTED");
  });

  test("Nexa 1.4 -> APPROVED: B8 does not exclude crypto", () => {
    const { byId: c, summary } = decide(evidenceCrypto(), ...NEXA_14);
    expect(c.B8!.result).toBe("PASS");
    expect(c.B8!.explanation).toBe(
      "Sectors assessed: wholesale_distribution, crypto_trading. None excluded by policy (gambling, unregistered_lending).",
    );
    expect(summary.outcome).toBe("APPROVED");
  });
});

describe("A.2.4: extraction available but empty", () => {
  function evidenceEmptyExtraction(): Evidence {
    return evidenceA1({
      operating_address: UNAVAILABLE,
      undisclosed_units: fact([], "extraction", "derived:no_units_found"),
      extracted_sectors: fact([], "extraction", "derived:no_sectors_found"),
    });
  }

  test("A6/B6 PASS, A5 still PASS, outcomes unchanged from A.1", () => {
    const k31 = decide(evidenceEmptyExtraction(), ...KAVERI_31);
    expect(k31.byId.A5!.result).toBe("PASS");
    expect(k31.byId.A5!.explanation).toContain(
      "Operating address not available; absence of a finding is not a mismatch.",
    );
    expect(k31.byId.A6!.result).toBe("PASS");
    expect(k31.byId.A6!.explanation).toBe("No undisclosed units noted.");
    expect(k31.summary.outcome).toBe("REJECTED");
    expect(k31.summary.degraded).toBe(false);

    expect(decide(evidenceEmptyExtraction(), ...KAVERI_32).summary.outcome).toBe("REVIEW");

    const nexa = decide(evidenceEmptyExtraction(), ...NEXA_14);
    expect(nexa.byId.B6!.result).toBe("PASS");
    expect(nexa.summary.outcome).toBe("APPROVED");
    expect(nexa.summary.degraded).toBe(false);
  });
});

describe("upstream fully down, model healthy", () => {
  test("Kaveri 3.1 -> REVIEW degraded, never REJECTED", () => {
    const { results, byId: c, summary } = decide(evidenceUpstreamDown(), ...KAVERI_31);

    expectResults(results, {
      A1: "UNDETERMINED",
      A2: "UNDETERMINED",
      A3: "UNDETERMINED",
      A4: "UNDETERMINED",
      A5: "UNDETERMINED",
      A6: "FAIL",
      A7: "FAIL",
      A8: "PASS",
    });

    expect(c.A1!.missing_inputs).toEqual(["incorporation_date"]);
    expect(c.A1!.explanation).toBe("Not evaluated: incorporation_date unavailable.");
    expect(c.A2!.missing_inputs).toEqual(["gstin_status", "last_return_filed"]);
    expect(c.A4!.missing_inputs).toEqual(["evidenced_turnover"]);
    expect(c.A1!.outcome).toBe("REVIEW");
    expect(c.A7!.result).toBe("FAIL");
    expect(c.A7!.outcome).toBe("REVIEW");

    expect(summary.outcome).toBe("REVIEW");
    expect(summary.degraded).toBe(true);
    expect(summary.degraded_reasons.length).toBe(5);
    expect(summary.degraded_reasons[0]).toBe(
      "A1: Not evaluated: incorporation_date unavailable.",
    );
  });

  test("Kaveri 3.2 -> REVIEW degraded", () => {
    const { summary } = decide(evidenceUpstreamDown(), ...KAVERI_32);
    expect(summary.outcome).toBe("REVIEW");
    expect(summary.degraded).toBe(true);
  });

  test("an UNDETERMINED clause can never be the thing that produces REJECT", () => {
    for (const version of ["3.1", "3.2"]) {
      const { summary } = decide(evidenceUpstreamDown(), "kaveri_capital", version);
      expect(summary.outcome).not.toBe("REJECTED");
    }
  });

  test("Nexa 1.4 -> APPROVED degraded", () => {
    const { results, byId: c, summary } = decide(evidenceUpstreamDown(), ...NEXA_14);

    expectResults(results, {
      B1: "UNDETERMINED",
      B2: "UNDETERMINED",
      B3: "UNDETERMINED",
      B4: "UNDETERMINED",
      B5: "UNDETERMINED",
      B6: "UNDETERMINED",
      B7: "FAIL",
      B8: "PASS",
    });

    expect(c.B7!.outcome).toBe("APPROVE");
    expect(summary.outcome).toBe("APPROVED");
    expect(summary.degraded).toBe(true);
    expect(summary.degraded_reasons.length).toBe(6);
  });
});

describe("MODEL_OUTAGE=true, upstream healthy", () => {
  test("A6 UNDETERMINED -> REVIEW; A1-A4 unaffected", () => {
    const { results, byId: c, summary } = decide(evidenceModelOutage(), ...KAVERI_31);

    expectResults(results, {
      A1: "FAIL",
      A2: "PASS",
      A3: "FAIL",
      A4: "PASS",
      A5: "PASS",
      A6: "UNDETERMINED",
      A7: "PASS",
      A8: "PASS",
    });

    expect(c.A6!.outcome).toBe("REVIEW");
    expect(c.A6!.missing_inputs).toEqual(["undisclosed_units"]);
    expect(c.A6!.evidence_refs).toEqual([]);
    expect(c.A1!.explanation).toContain("policy requires at least 36");
    expect(c.A3!.explanation).toContain("variance 42.2%");
    expect(c.A4!.explanation).toContain("24.5%");
    expect(c.A5!.result).toBe("PASS");

    expect(summary.outcome).toBe("REJECTED");
    expect(summary.degraded).toBe(true);
  });

  test("Kaveri 3.2 -> REVIEW degraded", () => {
    const { byId: c, summary } = decide(evidenceModelOutage(), ...KAVERI_32);
    expect(c.A6!.result).toBe("UNDETERMINED");
    expect(summary.outcome).toBe("REVIEW");
    expect(summary.degraded).toBe(true);
  });

  test("B6 UNDETERMINED -> APPROVE; Nexa APPROVED degraded", () => {
    const { byId: c, summary } = decide(evidenceModelOutage(), ...NEXA_14);
    expect(c.B6!.result).toBe("UNDETERMINED");
    expect(c.B6!.outcome).toBe("APPROVE");
    expect(c.B1!.result).toBe("PASS");
    expect(c.B4!.result).toBe("PASS");
    expect(summary.outcome).toBe("APPROVED");
    expect(summary.degraded).toBe(true);
  });
});

describe("polarity of the negatively-named checks", () => {
  test("address_mismatch FAILs when the PIN codes differ", () => {
    const evidence = evidenceA1({
      upstream_registered_address: fact(
        "No. 9, Industrial Suburb, Yeshwanthpur, Bengaluru 560022",
        "upstream",
        "upstream:registered_address",
      ),
    });
    const k = decide(evidence, ...KAVERI_31);
    expect(k.byId.A5!.result).toBe("FAIL");
    expect(k.byId.A5!.outcome).toBe("REVIEW");
    expect(k.byId.A5!.explanation).toContain("PIN codes 560058 and 560022 differ");

    const n = decide(evidence, ...NEXA_14);
    expect(n.byId.B5!.result).toBe("FAIL");
    expect(n.byId.B5!.outcome).toBe("APPROVE");
    expect(n.summary.outcome).toBe("APPROVED");
  });

  test("address_mismatch FAILs when the operating address is elsewhere", () => {
    const evidence = evidenceA1({
      operating_address: fact(
        "Plot 17, Antharasanahalli Industrial Area, Tumkur 572106",
        "extraction",
        "second godown in Tumkur",
      ),
    });
    const k = decide(evidence, ...KAVERI_31);
    expect(k.byId.A5!.result).toBe("FAIL");
    expect(k.byId.A5!.explanation).toContain("Operating address vs registered address");
  });

  test("undisclosed_units_present PASSES only when the list is empty", () => {
    const empty = decide(evidenceA1({ undisclosed_units: fact([], "extraction", "n/a") }), ...KAVERI_31);
    expect(empty.byId.A6!.result).toBe("PASS");

    const two = decide(
      evidenceA1({ undisclosed_units: fact(["Tumkur", "Hosur"], "extraction", "q") }),
      ...KAVERI_31,
    );
    expect(two.byId.A6!.result).toBe("FAIL");
    expect(two.byId.A6!.explanation).toBe("2 undisclosed units noted: Tumkur, Hosur.");
  });

  test("B6 FAILs only when units are present AND overstatement exceeds 100%", () => {
    const big = evidenceA1({
      declared_turnover: fact(54_000_000, "payload", "business.declared_annual_turnover_inr"),
    });
    const withUnits = decide(big, ...NEXA_14);
    expect(withUnits.byId.B6!.result).toBe("FAIL");
    expect(withUnits.byId.B6!.outcome).toBe("REVIEW");
    expect(withUnits.summary.outcome).toBe("REVIEW");

    const noUnits = decide(
      { ...big, undisclosed_units: fact([], "extraction", "n/a") },
      ...NEXA_14,
    );
    expect(noUnits.byId.B6!.result).toBe("PASS");
  });

  test("sector_excluded PASSES when no excluded sector is present", () => {
    const gambling = evidenceA1({
      all_sectors: fact(["gambling"], "derived", "derived:all_sectors"),
    });
    expect(decide(gambling, ...KAVERI_31).byId.A8!.result).toBe("FAIL");
    expect(decide(gambling, ...NEXA_14).byId.B8!.result).toBe("FAIL");
    expect(decide(gambling, ...NEXA_14).summary.outcome).toBe("REJECTED");
  });

  test("B3 applies and can FAIL for a business under 24 months old", () => {
    const young = evidenceA1({
      incorporation_date: fact("2025-01-15", "upstream", "upstream:incorporation_date"),
      declared_turnover: fact(54_000_000, "payload", "business.declared_annual_turnover_inr"),
    });
    const { byId: c, summary } = decide(young, ...NEXA_14);
    expect(c.B3!.result).toBe("FAIL");
    expect(c.B3!.outcome).toBe("REVIEW");
    expect(c.B3!.explanation).toBe(
      "Declared 5,40,00,000 vs evidenced 1,02,00,000; overstatement 429.4% of evidenced; policy allows up to 100%.",
    );
    expect(summary.outcome).toBe("REVIEW");
  });

  test("gstin_active_and_filed_within FAILs on a stale filing", () => {
    const stale = evidenceA1({
      last_return_filed: fact("2025-06-30", "upstream", "upstream:last_return_filed_on"),
    });
    const k = decide(stale, ...KAVERI_31);
    expect(k.byId.A2!.result).toBe("FAIL");
    expect(k.byId.A2!.outcome).toBe("REJECT");
    expect(k.byId.A2!.explanation).toContain("235 days before application date 2026-02-20");
    expect(decide(stale, ...NEXA_14).byId.B2!.result).toBe("PASS");
  });

  test("an inactive GSTIN FAILs both customers", () => {
    const suspended = evidenceA1({
      gstin_status: fact("SUSPENDED", "upstream", "upstream:status"),
    });
    expect(decide(suspended, ...KAVERI_31).byId.A2!.result).toBe("FAIL");
    const n = decide(suspended, ...NEXA_14);
    expect(n.byId.B2!.result).toBe("FAIL");
    expect(n.byId.B2!.explanation).toBe("GSTIN status SUSPENDED; policy requires status ACTIVE.");
    expect(n.summary.outcome).toBe("REJECTED");
  });
});

describe("determinism", () => {
  test("evaluate twice on identical inputs is deeply equal", () => {
    const policy = loadPolicy(...KAVERI_31);
    expect(evaluate(evidenceA1(), policy)).toEqual(evaluate(evidenceA1(), policy));
    expect(aggregate(evaluate(evidenceA1(), policy), policy)).toEqual(
      aggregate(evaluate(evidenceA1(), policy), policy),
    );
  });

  test("canonicalStringify sorts object keys recursively and preserves array order", () => {
    const a = { b: { d: 1, c: [3, 1, 2] }, a: 2 };
    const b = { a: 2, b: { c: [3, 1, 2], d: 1 } };
    expect(canonicalStringify(a)).toBe('{"a":2,"b":{"c":[3,1,2],"d":1}}');
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
    expect(canonicalStringify([{ z: 1, a: 2 }])).toBe('[{"a":2,"z":1}]');
  });

  test("sha256Hex is the standard digest", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("evidence and policy hashes are stable and sensitive", () => {
    const h1 = evidenceHash(evidenceA1());
    expect(h1).toBe(evidenceHash(evidenceA1()));
    expect(h1).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(h1).not.toBe(
      evidenceHash(evidenceA1({ loan_amount: fact(1, "payload", "loan.amount_inr") })),
    );

    const p31 = policyHash(loadPolicy(...KAVERI_31));
    expect(p31).toBe(policyHash(loadPolicy(...KAVERI_31)));
    expect(p31).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(p31).not.toBe(policyHash(loadPolicy(...KAVERI_32)));
  });
});

describe("address_mismatch tolerates a fragment of the same address", () => {
  const REGISTERED = "No. 42, 3rd Cross, Peenya Industrial Area, Bengaluru 560058";

  test("does not flag an operating address that is a fragment naming the same place", () => {
    expect(compareAddresses(REGISTERED, "Peenya premises").mismatch).toBe(false);
    expect(compareAddresses(REGISTERED, "the Peenya office").mismatch).toBe(false);
    expect(compareAddresses(REGISTERED, "Peenya Industrial Area, Bengaluru 560058").mismatch).toBe(false);
  });

  test("still flags a genuinely different location", () => {
    expect(compareAddresses(REGISTERED, "second godown in Tumkur").mismatch).toBe(true);
    expect(compareAddresses(REGISTERED, "Tumkur").mismatch).toBe(true);
    expect(compareAddresses(REGISTERED, "Whitefield, Bengaluru 560066").mismatch).toBe(true);
  });
});

describe("E.1: clean, well-established applicant", () => {
  function evidenceE1(overrides: Evidence = {}): Evidence {
    return {
      applied_on: fact(SAMPLE_E1.applied_on, "payload", "applied_on"),
      loan_amount: fact(SAMPLE_E1.loan.amount_inr, "payload", "loan.amount_inr"),
      declared_turnover: fact(
        SAMPLE_E1.business.declared_annual_turnover_inr,
        "payload",
        "business.declared_annual_turnover_inr",
      ),
      payload_registered_address: fact(
        SAMPLE_E1.business.registered_address,
        "payload",
        "business.registered_address",
      ),
      declared_sectors: fact(["wholesale_distribution"], "payload", "business.sector"),
      gstin_status: fact(UPSTREAM_E1.status, "upstream", "upstream:status"),
      incorporation_date: fact(UPSTREAM_E1.incorporation_date, "upstream", "upstream:incorporation_date"),
      last_return_filed: fact(UPSTREAM_E1.last_return_filed_on, "upstream", "upstream:last_return_filed_on"),
      evidenced_turnover: fact(
        UPSTREAM_E1.filings_annual_turnover_inr,
        "upstream",
        "upstream:filings_annual_turnover_inr",
      ),
      upstream_registered_address: fact(
        UPSTREAM_E1.registered_address,
        "upstream",
        "upstream:registered_address",
      ),
      operating_address: fact(
        UPSTREAM_E1.registered_address,
        "extraction",
        "Principal Place of Business: Unit 12, Sahyadri Trade Centre, Market Yard Road, Gultekdi, Pune 411037",
      ),
      undisclosed_units: fact([], "extraction", "derived:no_units_found"),
      extracted_sectors: fact(
        ["wholesale_distribution"],
        "extraction",
        "Nature of Business Activities: Wholesale of packaged foods and home care products; Warehouse / Depot",
      ),
      verification_succeeded: fact(true, "derived", "derived:upstream_responded"),
      all_sectors: fact(["wholesale_distribution"], "derived", "derived:all_sectors"),
      ...overrides,
    };
  }

  for (const [customer, version] of ALL_POLICIES) {
    test(`${customer}@${version} -> APPROVED with no failed or undetermined clause`, () => {
      const { results, summary } = decide(evidenceE1(), customer, version);
      expect(results.filter((r) => r.result === "FAIL" || r.result === "UNDETERMINED")).toEqual([]);
      expect(summary.outcome).toBe("APPROVED");
      expect(summary.degraded).toBe(false);
    });
  }

  test("model outage: only the undisclosed-units input is missing", () => {
    const outage = evidenceE1({
      operating_address: UNAVAILABLE,
      undisclosed_units: UNAVAILABLE,
      extracted_sectors: UNAVAILABLE,
    });
    const outcomes = Object.fromEntries(
      ALL_POLICIES.map(([c, v]) => [`${c}@${v}`, decide(outage, c, v).summary.outcome]),
    );
    expect(outcomes).toEqual({
      "kaveri_capital@3.1": "REVIEW",
      "kaveri_capital@3.2": "REVIEW",
      "nexa_finserv@1.4": "APPROVED",
      "palar_msme@1.1": "REVIEW",
      "tapti_tradefin@2.0": "REVIEW",
      "vamsadhara_coop@1.0": "REVIEW",
    });
  });
});

describe("added customers on the Appendix A samples", () => {
  test("A.1: Palar approves, Tapti rejects on the undisclosed unit, Vamsadhara sends it to committee", () => {
    const palar = decide(evidenceA1(), ...PALAR_11);
    expect(palar.byId.P4!.result).toBe("PASS");
    expect(palar.byId.P5!.result).toBe("NOT_APPLICABLE");
    expect(palar.summary.outcome).toBe("APPROVED");

    const tapti = decide(evidenceA1(), ...TAPTI_20);
    expect(tapti.byId.T8!.result).toBe("FAIL");
    expect(tapti.byId.T8!.outcome).toBe("REJECT");
    expect(tapti.summary.outcome).toBe("REJECTED");

    const vamsadhara = decide(evidenceA1(), ...VAMSADHARA_10);
    expect(vamsadhara.byId.V6!.result).toBe("FAIL");
    expect(vamsadhara.summary.outcome).toBe("REVIEW");
  });

  test("A.2.3: every added customer excludes crypto trading", () => {
    const crypto = evidenceA1({
      all_sectors: fact(["wholesale_distribution", "crypto_trading"], "derived", "derived:all_sectors"),
    });
    expect(decide(crypto, ...PALAR_11).byId.P11!.result).toBe("FAIL");
    expect(decide(crypto, ...TAPTI_20).byId.T10!.result).toBe("FAIL");
    expect(decide(crypto, ...VAMSADHARA_10).byId.V8!.result).toBe("FAIL");
    for (const policy of [PALAR_11, TAPTI_20, VAMSADHARA_10]) {
      expect(decide(crypto, ...policy).summary.outcome).toBe("REJECTED");
    }
  });

  test("A.2.4: nothing extracted leaves Tapti on the turnover gap and approves the others", () => {
    const empty = evidenceA1({
      operating_address: UNAVAILABLE,
      undisclosed_units: fact([], "extraction", "derived:no_units_found"),
      extracted_sectors: fact([], "extraction", "derived:no_sectors_found"),
    });
    expect(decide(empty, ...PALAR_11).summary.outcome).toBe("APPROVED");
    expect(decide(empty, ...VAMSADHARA_10).summary.outcome).toBe("APPROVED");
    const tapti = decide(empty, ...TAPTI_20);
    expect(tapti.byId.T4!.result).toBe("FAIL");
    expect(tapti.byId.T5!.result).toBe("FAIL");
    expect(tapti.summary.outcome).toBe("REVIEW");
  });

  test("an undetermined clause never rejects for the added customers", () => {
    for (const policy of [PALAR_11, TAPTI_20, VAMSADHARA_10]) {
      const { results, summary } = decide(evidenceModelOutage(), ...policy);
      expect(results.some((r) => r.result === "UNDETERMINED")).toBe(true);
      expect(summary.outcome).toBe("REVIEW");
      expect(summary.degraded).toBe(true);
    }
  });
});

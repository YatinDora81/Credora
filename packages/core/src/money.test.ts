import { describe, it, expect } from "bun:test";
import { normaliseMoney, type MoneyResult, type Period } from "./money";

interface Row {
  input: string;
  amountInr: number;
  period: Period;
  annualisedInr: number;
}

const TABLE: Row[] = [
  { input: "Rs. 1.45 crore", amountInr: 14500000, period: "UNKNOWN", annualisedInr: 14500000 },
  { input: "₹1,45,00,000", amountInr: 14500000, period: "UNKNOWN", annualisedInr: 14500000 },
  { input: "14.5 lakh", amountInr: 1450000, period: "UNKNOWN", annualisedInr: 1450000 },
  { input: "1,45,00,000", amountInr: 14500000, period: "UNKNOWN", annualisedInr: 14500000 },
  { input: "45 lakh a month", amountInr: 4500000, period: "MONTHLY", annualisedInr: 54000000 },
  { input: "INR 10,00,000", amountInr: 1000000, period: "UNKNOWN", annualisedInr: 1000000 },
  { input: "2.5 cr per annum", amountInr: 25000000, period: "ANNUAL", annualisedInr: 25000000 },
  { input: "Rs 45,00,000 per month", amountInr: 4500000, period: "MONTHLY", annualisedInr: 54000000 },
  {
    input: "Aggregate turnover declared for FY 2024-25: Rs. 1.45 crore",
    amountInr: 14500000,
    period: "ANNUAL",
    annualisedInr: 14500000,
  },
];

describe("normaliseMoney — the section 7 table", () => {
  for (const row of TABLE) {
    it(`${row.input} -> ${row.amountInr} ${row.period} / ${row.annualisedInr}`, () => {
      const r = normaliseMoney(row.input);
      expect(r).not.toBeNull();
      const got = r as MoneyResult;
      expect(got.amountInr).toBe(row.amountInr);
      expect(got.period).toBe(row.period);
      expect(got.annualisedInr).toBe(row.annualisedInr);
    });
  }

  it('"no figures here" -> null', () => {
    expect(normaliseMoney("no figures here")).toBeNull();
  });
});

describe("normaliseMoney — the FY trap", () => {
  it("takes 1.45, never 2024, out of 'FY 2024-25'", () => {
    const r = normaliseMoney(
      "Aggregate turnover declared for FY 2024-25: Rs. 1.45 crore",
    )!;
    expect(r.matchedText).toBe("1.45 crore");
    expect(r.amountInr).not.toBe(2024);
    expect(r.amountInr).not.toBe(25);
  });

  it("a bare financial year with a figure after it still reads the figure", () => {
    const r = normaliseMoney("FY 2023-24 turnover of Rs 90 lakh")!;
    expect(r).toEqual({
      amountInr: 9000000,
      period: "ANNUAL",
      annualisedInr: 9000000,
      matchedText: "90 lakh",
    });
  });
});

describe("normaliseMoney — Indian grouping and multiplier words", () => {
  it("1,45,00,000 is 1.45 crore, and ten times 14.5 lakh", () => {
    const grouped = normaliseMoney("1,45,00,000")!;
    const crore = normaliseMoney("1.45 crore")!;
    const lakh = normaliseMoney("14.5 lakh")!;
    expect(grouped.amountInr).toBe(crore.amountInr);
    expect(grouped.amountInr).toBe(lakh.amountInr * 10);
    expect(normaliseMoney("145 lakh")!.amountInr).toBe(grouped.amountInr);
  });

  it("accepts a multiplier with no space", () => {
    expect(normaliseMoney("2.5cr")!.amountInr).toBe(25000000);
    expect(normaliseMoney("12k")!.amountInr).toBe(12000);
  });

  it("accepts the lac / lacs / lakhs spellings", () => {
    expect(normaliseMoney("45 lac")!.amountInr).toBe(4500000);
    expect(normaliseMoney("45 lacs")!.amountInr).toBe(4500000);
    expect(normaliseMoney("45 lakhs")!.amountInr).toBe(4500000);
  });

  it("treats thousand and k alike", () => {
    expect(normaliseMoney("50 thousand")!.amountInr).toBe(50000);
    expect(normaliseMoney("50k")!.amountInr).toBe(50000);
  });

  it("rounds to whole rupees", () => {
    expect(normaliseMoney("1.234567 lakh")!.amountInr).toBe(123457);
  });
});

describe("normaliseMoney — period detection", () => {
  it("reads p.m., /month and monthly as MONTHLY", () => {
    expect(normaliseMoney("45 lacs p.m.")!.annualisedInr).toBe(54000000);
    expect(normaliseMoney("₹45,00,000/month")!.annualisedInr).toBe(54000000);
    expect(normaliseMoney("Rs 45,00,000 monthly")!.annualisedInr).toBe(54000000);
  });

  it("reads p.a., annually and per annum as ANNUAL and does not multiply", () => {
    for (const s of ["Rs. 1.45 crore p.a.", "1.45 crore annually", "1.45 crore per annum"]) {
      const r = normaliseMoney(s)!;
      expect(r.period).toBe("ANNUAL");
      expect(r.annualisedInr).toBe(14500000);
    }
  });

  it("leaves an unqualified figure UNKNOWN rather than guessing", () => {
    expect(normaliseMoney("Rs. 1.45 crore")!.period).toBe("UNKNOWN");
  });

  it("annualises the A.2.2 arithmetic trap without the model doing the sum", () => {
    const r = normaliseMoney("around 45 lakh a month")!;
    expect(r.amountInr).toBe(4500000);
    expect(r.period).toBe("MONTHLY");
    expect(r.annualisedInr).toBe(54000000);
  });
});

describe("normaliseMoney — no number at all", () => {
  it("returns null for empty, whitespace and prose", () => {
    expect(normaliseMoney("")).toBeNull();
    expect(normaliseMoney("   ")).toBeNull();
    expect(normaliseMoney("not disclosed")).toBeNull();
    expect(normaliseMoney("Rs. lakhs per month")).toBeNull();
  });
});

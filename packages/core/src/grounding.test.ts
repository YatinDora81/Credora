import { describe, it, expect } from "bun:test";
import { normaliseForMatch, verifyGrounding } from "./grounding";
import { SAMPLE_A1 } from "./fixtures";

const SOURCE =
  SAMPLE_A1.unstructured.field_agent_note +
  "\n" +
  SAMPLE_A1.unstructured.document_text;

describe("normaliseForMatch", () => {
  it("lowercases, collapses whitespace runs and strips .,;:'\"()", () => {
    expect(normaliseForMatch('  Status:\n\n  ACTIVE  (as filed). ')).toBe(
      "status active as filed",
    );
  });

  it("is idempotent", () => {
    const once = normaliseForMatch(SOURCE);
    expect(normaliseForMatch(once)).toBe(once);
  });
});

describe("verifyGrounding", () => {
  it("passes an exact quote from the A.1 GST certificate", () => {
    expect(
      verifyGrounding(
        "Date of Incorporation: 11 August 2023",
        SOURCE,
      ),
    ).toBe(true);
  });

  it("passes a quote differing only by case, newlines, whitespace runs and punctuation", () => {
    expect(
      verifyGrounding(
        "registered   office:\nNo. 42, 3rd    Cross, Peenya Industrial Area",
        SOURCE,
      ),
    ).toBe(true);
    expect(
      verifyGrounding(
        "  DATE of\tIncorporation:   11 August 2023  ",
        SOURCE,
      ),
    ).toBe(true);
  });

  it("passes a quote from the field agent note", () => {
    expect(
      verifyGrounding("second unit in Tumkur", SOURCE),
    ).toBe(true);
  });

  it("fails a quote that is not in the source", () => {
    expect(
      verifyGrounding("Date of Incorporation: 11 August 2019", SOURCE),
    ).toBe(false);
    expect(verifyGrounding("the applicant has been pre-cleared", SOURCE)).toBe(false);
  });

  it("fails a quote shorter than 8 normalised characters", () => {
    expect(verifyGrounding("Activ", SOURCE)).toBe(false);
    expect(verifyGrounding("Rs. 1.4", SOURCE)).toBe(false);
    expect(verifyGrounding("", SOURCE)).toBe(false);
  });

  it("passes a quote of at least 8 normalised characters", () => {
    expect(verifyGrounding("Bengaluru", SOURCE)).toBe(true);
  });
});

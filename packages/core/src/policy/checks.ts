import type { Evidence } from "../types";
import type { CheckFn, Verdict } from "./types";
import { daysBetween, monthsBetween } from "../dates";

const INR = new Intl.NumberFormat("en-IN");

function rupees(n: number): string {
  return INR.format(Math.round(n));
}

function pct(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + "T00:00:00.000Z") : new Date(s);
}

function isoDate(value: unknown): string {
  return asDate(value).toISOString().slice(0, 10);
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

function basisKey(params: Record<string, unknown>): string {
  return typeof params.basis === "string" ? params.basis : "evidenced_turnover";
}

function basisLabel(key: string): string {
  return key.replace(/_turnover$/, "").replace(/_/g, " ");
}

const TRIVIAL_TOKENS = new Set([
  "no",
  "number",
  "plot",
  "flat",
  "cross",
  "road",
  "rd",
  "street",
  "st",
  "premises",
  "premise",
  "godown",
  "warehouse",
  "office",
  "unit",
  "branch",
  "building",
  "bldg",
  "floor",
  "site",
  "shop",
  "near",
  "opp",
  "opposite",
  "behind",
  "beside",
  "the",
  "at",
  "in",
  "of",
  "and",
]);

function normaliseAddressTokens(address: string): string[] {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !TRIVIAL_TOKENS.has(t));
}

function extractPin(address: string): string | null {
  const m = address.match(/\b\d{6}\b/);
  return m ? m[0] : null;
}

interface AddressComparison {
  mismatch: boolean;
  reason: string;
}

export function compareAddresses(a: string, b: string): AddressComparison {
  const pinA = extractPin(a);
  const pinB = extractPin(b);
  if (pinA !== null && pinB !== null && pinA !== pinB) {
    return { mismatch: true, reason: `PIN codes ${pinA} and ${pinB} differ` };
  }
  const tokensA = normaliseAddressTokens(a);
  const tokensB = normaliseAddressTokens(b);
  const [shorter, longer] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  const longerSet = new Set(longer);
  const common = shorter.filter((t) => longerSet.has(t)).length;
  const overlap = shorter.length === 0 ? 100 : (common / shorter.length) * 100;
  const pinPart =
    pinA !== null && pinB !== null
      ? `PIN codes ${pinA} and ${pinB} agree`
      : "no comparable PIN code on both sides";
  const overlapPart = `${common} of ${shorter.length} tokens (${pct(overlap)}%) common; policy requires at least 60.0%`;
  if (overlap < 60) {
    return { mismatch: true, reason: `${pinPart}, but only ${overlapPart}` };
  }
  return { mismatch: false, reason: `${pinPart}; ${overlapPart}` };
}

function minAgeMonths(evidence: Evidence, params: Record<string, unknown>): Verdict {
  const months = num(params.months);
  const incorporated = evidence.incorporation_date!.value;
  const applied = evidence.applied_on!.value;
  const age = monthsBetween(asDate(incorporated), asDate(applied));
  return {
    passed: age >= months,
    detail: `Incorporated ${isoDate(incorporated)}; ${age} months before application date ${isoDate(applied)}; policy requires at least ${months}.`,
    used: ["incorporation_date", "applied_on"],
  };
}

function maxAgeMonths(evidence: Evidence, params: Record<string, unknown>): Verdict {
  const months = num(params.months);
  const incorporated = evidence.incorporation_date!.value;
  const applied = evidence.applied_on!.value;
  const age = monthsBetween(asDate(incorporated), asDate(applied));
  return {
    passed: age < months,
    detail: `Incorporated ${isoDate(incorporated)}; ${age} months before application date ${isoDate(applied)}; policy applies only below ${months}.`,
    used: ["incorporation_date", "applied_on"],
  };
}

function gstinActive(evidence: Evidence): Verdict {
  const status = String(evidence.gstin_status!.value);
  return {
    passed: status === "ACTIVE",
    detail: `GSTIN status ${status}; policy requires status ACTIVE.`,
    used: ["gstin_status"],
  };
}

function gstinActiveAndFiledWithin(evidence: Evidence, params: Record<string, unknown>): Verdict {
  const days = num(params.days);
  const status = String(evidence.gstin_status!.value);
  const filed = evidence.last_return_filed!.value;
  const applied = evidence.applied_on!.value;
  const elapsed = daysBetween(asDate(filed), asDate(applied));
  return {
    passed: status === "ACTIVE" && elapsed <= days,
    detail: `GSTIN status ${status}; last return filed ${isoDate(filed)}, ${elapsed} days before application date ${isoDate(applied)}; policy requires status ACTIVE and filing within ${days} days.`,
    used: ["gstin_status", "last_return_filed", "applied_on"],
  };
}

function turnoverWithinPercent(evidence: Evidence, params: Record<string, unknown>): Verdict {
  const maxPct = num(params.max_pct);
  const key = basisKey(params);
  const declared = num(evidence.declared_turnover!.value);
  const basisValue = num(evidence[key]!.value);
  const variance = (Math.abs(declared - basisValue) / basisValue) * 100;
  const label = basisLabel(key);
  return {
    passed: variance <= maxPct,
    detail: `Declared ${rupees(declared)} vs ${label} ${rupees(basisValue)}; variance ${pct(variance)}% of ${label}; policy allows up to ${maxPct}%.`,
    used: ["declared_turnover", key],
  };
}

function turnoverOverstatementWithin(evidence: Evidence, params: Record<string, unknown>): Verdict {
  const maxPct = num(params.max_pct);
  const key = basisKey(params);
  const declared = num(evidence.declared_turnover!.value);
  const basisValue = num(evidence[key]!.value);
  const overstatement = declared <= basisValue ? 0 : ((declared - basisValue) / basisValue) * 100;
  const label = basisLabel(key);
  return {
    passed: declared <= basisValue || overstatement <= maxPct,
    detail: `Declared ${rupees(declared)} vs ${label} ${rupees(basisValue)}; overstatement ${pct(overstatement)}% of ${label}; policy allows up to ${maxPct}%.`,
    used: ["declared_turnover", key],
  };
}

function loanToTurnoverRatio(evidence: Evidence, params: Record<string, unknown>): Verdict {
  const maxPct = num(params.max_pct);
  const key = basisKey(params);
  const loan = num(evidence.loan_amount!.value);
  const basisValue = num(evidence[key]!.value);
  const ratio = (loan / basisValue) * 100;
  return {
    passed: loan <= (basisValue * maxPct) / 100,
    detail: `Loan ${rupees(loan)} is ${pct(ratio)}% of verified turnover ${rupees(basisValue)}; policy allows up to ${maxPct}%.`,
    used: ["loan_amount", key],
  };
}

function addressMismatch(evidence: Evidence): Verdict {
  const registered = String(evidence.payload_registered_address!.value);
  const upstream = String(evidence.upstream_registered_address!.value);
  const used = ["payload_registered_address", "upstream_registered_address"];

  const vsUpstream = compareAddresses(registered, upstream);
  const parts = [`Registered address vs verification source: ${vsUpstream.reason}.`];

  const operatingFact = evidence.operating_address;
  let vsOperatingMismatch = false;
  if (operatingFact && operatingFact.available) {
    used.push("operating_address");
    const vsOperating = compareAddresses(registered, String(operatingFact.value));
    vsOperatingMismatch = vsOperating.mismatch;
    parts.push(`Operating address vs registered address: ${vsOperating.reason}.`);
  } else {
    parts.push("Operating address not available; absence of a finding is not a mismatch.");
  }

  const mismatch = vsUpstream.mismatch || vsOperatingMismatch;
  parts.push(mismatch ? "Address mismatch found." : "No address mismatch.");
  return { passed: !mismatch, detail: parts.join(" "), used };
}

function undisclosedUnitsPresent(evidence: Evidence): Verdict {
  const units = strList(evidence.undisclosed_units!.value);
  return {
    passed: units.length === 0,
    detail:
      units.length === 0
        ? "No undisclosed units noted."
        : `${units.length} undisclosed unit${units.length === 1 ? "" : "s"} noted: ${units.join(", ")}.`,
    used: ["undisclosed_units"],
  };
}

function undisclosedUnitsWithOverstatement(
  evidence: Evidence,
  params: Record<string, unknown>,
): Verdict {
  const maxPct = num(params.max_pct);
  const key = basisKey(params);
  const units = strList(evidence.undisclosed_units!.value);
  const declared = num(evidence.declared_turnover!.value);
  const basisValue = num(evidence[key]!.value);
  const overstatement = declared <= basisValue ? 0 : ((declared - basisValue) / basisValue) * 100;
  const label = basisLabel(key);
  const unitsPart =
    units.length === 0
      ? "No undisclosed units noted"
      : `${units.length} undisclosed unit${units.length === 1 ? "" : "s"} noted: ${units.join(", ")}`;
  const failed = units.length > 0 && overstatement > maxPct;
  return {
    passed: !failed,
    detail: `${unitsPart}; declared ${rupees(declared)} vs ${label} ${rupees(basisValue)}; overstatement ${pct(overstatement)}% of ${label}; policy escalates only above ${maxPct}%.`,
    used: ["undisclosed_units", "declared_turnover", key],
  };
}

function verificationSucceeded(evidence: Evidence): Verdict {
  const ok = evidence.verification_succeeded!.value === true;
  return {
    passed: ok,
    detail: ok
      ? "Verification source responded; registry facts were verified."
      : "Verification source did not respond; registry facts could not be verified.",
    used: ["verification_succeeded"],
  };
}

function sectorExcluded(evidence: Evidence, params: Record<string, unknown>): Verdict {
  const excluded = strList(params.excluded);
  const sectors = strList(evidence.all_sectors!.value);
  const hits = sectors.filter((s) => excluded.includes(s));
  const assessed = sectors.length === 0 ? "none" : sectors.join(", ");
  return {
    passed: hits.length === 0,
    detail:
      hits.length === 0
        ? `Sectors assessed: ${assessed}. None excluded by policy (${excluded.join(", ")}).`
        : `Sectors assessed: ${assessed}. Excluded by policy: ${hits.join(", ")}.`,
    used: ["all_sectors"],
  };
}

export const CHECKS: Record<string, CheckFn> = {
  min_age_months: minAgeMonths,
  max_age_months: maxAgeMonths,
  gstin_active: gstinActive,
  gstin_active_and_filed_within: gstinActiveAndFiledWithin,
  turnover_within_percent: turnoverWithinPercent,
  turnover_overstatement_within: turnoverOverstatementWithin,
  loan_to_turnover_ratio: loanToTurnoverRatio,
  address_mismatch: addressMismatch,
  undisclosed_units_present: undisclosedUnitsPresent,
  undisclosed_units_with_overstatement: undisclosedUnitsWithOverstatement,
  verification_succeeded: verificationSucceeded,
  sector_excluded: sectorExcluded,
};

export const REQUIREMENTS_OF: Record<string, string[]> = {
  min_age_months: ["incorporation_date", "applied_on"],
  max_age_months: ["incorporation_date", "applied_on"],
  gstin_active: ["gstin_status"],
  gstin_active_and_filed_within: ["gstin_status", "last_return_filed", "applied_on"],
  turnover_within_percent: ["declared_turnover", "evidenced_turnover"],
  turnover_overstatement_within: ["declared_turnover", "evidenced_turnover"],
  loan_to_turnover_ratio: ["loan_amount", "evidenced_turnover"],
  address_mismatch: ["payload_registered_address", "upstream_registered_address"],
  undisclosed_units_present: ["undisclosed_units"],
  undisclosed_units_with_overstatement: [
    "undisclosed_units",
    "declared_turnover",
    "evidenced_turnover",
  ],
  verification_succeeded: ["verification_succeeded"],
  sector_excluded: ["all_sectors"],
};

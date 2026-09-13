import type { AggregateSummary, ClauseOutcome, ClauseResult } from "../types";
import type { Policy } from "./types";

const SEVERITY: Record<ClauseOutcome, number> = { APPROVE: 0, REVIEW: 1, REJECT: 2 };

export function aggregate(results: ClauseResult[], policy: Policy): AggregateSummary {
  let outcome: ClauseOutcome = "APPROVE";
  for (const r of results) {
    if (SEVERITY[r.outcome] > SEVERITY[outcome]) outcome = r.outcome;
  }

  const undetermined = results.filter((r) => r.result === "UNDETERMINED");
  const degraded = undetermined.length > 0;

  if (policy.cap_undetermined_at && outcome === "REJECT") {
    const rejectFromDetermined = results.some(
      (r) => r.outcome === "REJECT" && r.result === "FAIL",
    );
    if (!rejectFromDetermined) outcome = policy.cap_undetermined_at;
  }

  return {
    outcome:
      outcome === "APPROVE" ? "APPROVED" : outcome === "REJECT" ? "REJECTED" : "REVIEW",
    degraded,
    degraded_reasons: undetermined.map((r) => r.clause_id + ": " + r.explanation),
  };
}

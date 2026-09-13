import type { ClauseResult, Evidence } from "../types";
import type { Policy } from "./types";
import { CHECKS, REQUIREMENTS_OF } from "./checks";

export function evaluate(evidence: Evidence, policy: Policy): ClauseResult[] {
  return policy.clauses.map((clause): ClauseResult => {
    if (clause.applies_when) {
      const gateReqs = REQUIREMENTS_OF[clause.applies_when.check] ?? [];
      const gateMissing = gateReqs.filter((k) => !evidence[k]?.available);
      if (gateMissing.length === 0) {
        const gate = CHECKS[clause.applies_when.check]!(evidence, clause.applies_when.params);
        if (!gate.passed) {
          return {
            clause_id: clause.id,
            clause_text: clause.text,
            result: "NOT_APPLICABLE",
            outcome: "APPROVE",
            explanation: "Clause does not apply: " + gate.detail,
            evidence_refs: [],
          };
        }
      }
    }

    const missing = clause.requires.filter((k) => !evidence[k]?.available);
    if (missing.length > 0) {
      return {
        clause_id: clause.id,
        clause_text: clause.text,
        result: "UNDETERMINED",
        outcome: clause.on_undetermined,
        explanation: "Not evaluated: " + missing.join(", ") + " unavailable.",
        evidence_refs: [],
        missing_inputs: missing,
      };
    }

    const v = CHECKS[clause.check]!(evidence, clause.params);
    return {
      clause_id: clause.id,
      clause_text: clause.text,
      result: v.passed ? "PASS" : "FAIL",
      outcome: v.passed ? "APPROVE" : clause.on_fail,
      explanation: v.detail,
      evidence_refs: v.used
        .map((k) => evidence[k]?.provenance)
        .filter((p): p is string => Boolean(p)),
    };
  });
}

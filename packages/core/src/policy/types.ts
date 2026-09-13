import type { ClauseOutcome, Evidence } from "../types";

export interface Clause {
  id: string;
  text: string;
  check: string;
  params: Record<string, unknown>;
  requires: string[];
  applies_when?: { check: string; params: Record<string, unknown> };
  on_fail: ClauseOutcome;
  on_undetermined: ClauseOutcome;
}

export interface Policy {
  customer: string;
  version: string;
  extends?: string;
  cap_undetermined_at?: ClauseOutcome;
  mark_degraded_only?: boolean;
  clauses: Clause[];
}

export interface PolicyFile {
  customer: string;
  version: string;
  extends?: string;
  cap_undetermined_at?: ClauseOutcome;
  mark_degraded_only?: boolean;
  clauses?: Clause[];
  overrides?: Record<string, Partial<Clause>>;
}

export interface Verdict {
  passed: boolean;
  detail: string;
  used: string[];
}

export type CheckFn = (evidence: Evidence, params: Record<string, unknown>) => Verdict;

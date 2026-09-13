import type { Extraction } from "./extraction-schema";

export type FactSource = "payload" | "upstream" | "extraction" | "derived";

export interface Fact<T = unknown> {
  value: T | null;
  available: boolean;
  source: FactSource | null;
  provenance: string | null;
}

export type Evidence = Record<string, Fact>;

export type ClauseOutcome = "APPROVE" | "REVIEW" | "REJECT";
export type ClauseResultKind = "PASS" | "FAIL" | "UNDETERMINED" | "NOT_APPLICABLE";

export interface ClauseResult {
  clause_id: string;
  clause_text: string;
  result: ClauseResultKind;
  outcome: ClauseOutcome;
  explanation: string;
  evidence_refs: string[];
  missing_inputs?: string[];
}

export type DecisionOutcome = "APPROVED" | "REVIEW" | "REJECTED";

export interface AggregateSummary {
  outcome: DecisionOutcome;
  degraded: boolean;
  degraded_reasons: string[];
}

export type ConcernCode =
  | "SOURCE_CONTRADICTION"
  | "TURNOVER_CONTRADICTION"
  | "PROMPT_INJECTION_ATTEMPT"
  | "NO_UNSTRUCTURED_MATERIAL";

export interface Concern {
  code: ConcernCode | string;
  detail: string;
  quote: string;
}

export interface ApplicationPayload {
  application_id_external?: string;
  applied_on: string;
  business: {
    legal_name: string;
    pan: string;
    gstin: string;
    registered_address: string;
    declared_annual_turnover_inr: number;
    sector: string;
  };
  loan: {
    amount_inr: number;
    tenure_months: number;
    purpose: string;
  };
  unstructured: {
    field_agent_note: string;
    document_text: string;
  };
}

export type GstinStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED" | "NOT_FOUND";

export interface UpstreamResult {
  gstin: string;
  status: GstinStatus | string;
  legal_name: string | null;
  incorporation_date: string | null;
  last_return_filed_on: string | null;
  registered_address: string | null;
  filings_annual_turnover_inr: number | null;
  source: string;
  retrieved_at: string;
}

export type UpstreamCallOutcome =
  | "SUCCESS"
  | "HTTP_5XX"
  | "HTTP_4XX"
  | "TIMEOUT"
  | "CONN_RESET"
  | "RATE_LIMITED"
  | "CIRCUIT_OPEN";

export interface UpstreamCallRecord {
  attempt: number;
  startedAt: string;
  durationMs: number;
  outcome: UpstreamCallOutcome;
  statusCode?: number | null;
  retryAfterSec?: number | null;
  error?: string | null;
}

export type ExtractionUnavailableReason =
  | "MODEL_UNAVAILABLE"
  | "MODEL_OUTPUT_INVALID"
  | "MODEL_OUTAGE_SIMULATED"
  | "MODEL_RATE_LIMITED"
  | "MODEL_NOT_CONFIGURED";

export type QuoteSource = "field_agent_note" | "document_text" | "combined";

export interface ExtractionFieldView {
  name: string;
  value: string;
  grounded: boolean;
  provenance: { quote: string; source: QuoteSource };
}

export interface UngroundedFieldView {
  name: string;
  value: string;
  quote: string;
}

export interface ExtractionEnvelope {
  available: boolean;
  reason: ExtractionUnavailableReason | null;
  extraction: Extraction | null;
  fields: ExtractionFieldView[];
  ungrounded: UngroundedFieldView[];
  concerns: Concern[];
  model: string | null;
  cached: boolean;
}

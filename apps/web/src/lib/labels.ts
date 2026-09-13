export const STATUS_LABEL: Record<string, string> = {
  PROCESSING: "Processing",
  APPROVED: "Approved",
  REVIEW: "Needs review",
  REJECTED: "Rejected",
  FAILED: "Failed",
};

export const RESULT_LABEL: Record<string, string> = {
  PASS: "Passed",
  FAIL: "Failed",
  UNDETERMINED: "Undetermined",
  NOT_APPLICABLE: "Not applicable",
};

export const CLAUSE_OUTCOME_LABEL: Record<string, string> = {
  APPROVE: "Approve",
  REVIEW: "Review",
  REJECT: "Reject",
};

export const CALL_OUTCOME_LABEL: Record<string, string> = {
  SUCCESS: "Succeeded",
  HTTP_5XX: "Server error",
  HTTP_4XX: "Client error",
  TIMEOUT: "Timed out",
  CONN_RESET: "Connection reset",
  RATE_LIMITED: "Rate limited",
  CIRCUIT_OPEN: "Circuit open, not sent",
};

export const CONCERN_LABEL: Record<string, string> = {
  PROMPT_INJECTION_ATTEMPT: "Instruction found in the document",
  SOURCE_CONTRADICTION: "Sources disagree",
  TURNOVER_CONTRADICTION: "Turnover figures disagree",
  NO_UNSTRUCTURED_MATERIAL: "Nothing to read",
};

export const EXTRACTION_REASON_LABEL: Record<string, string> = {
  MODEL_OUTAGE_SIMULATED: "The model-outage switch is on",
  MODEL_OUTAGE: "The model-outage switch is on",
  MODEL_NOT_CONFIGURED: "No Gemini key is configured",
  MODEL_UNAVAILABLE: "The model did not respond",
  MODEL_OUTPUT_INVALID: "The model returned output that failed validation twice",
  MODEL_RATE_LIMITED: "The model rate limit was reached",
  MODEL_TIMEOUT: "The model timed out",
};

export const SOURCE_LABEL: Record<string, string> = {
  document_text: "document",
  field_agent_note: "field agent note",
  combined: "note and document",
};

export function humanize(code: string | null | undefined): string {
  if (!code) return "";
  const words = code.replace(/[_\-.]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function fieldLabel(name: string | null | undefined): string {
  if (!name) return "";
  const m = /^(.+)\[(\d+)\]$/.exec(name);
  if (!m) return humanize(name);
  return `${humanize(m[1]).replace(/s$/, "")} ${Number(m[2]) + 1}`;
}

export function label(map: Record<string, string>, code: string | null | undefined): string {
  if (!code) return "";
  return map[code] ?? humanize(code);
}

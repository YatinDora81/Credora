export type ApplicationStatus =
  | "PROCESSING"
  | "APPROVED"
  | "REVIEW"
  | "REJECTED"
  | "FAILED";

export type ClauseResultKind = "PASS" | "FAIL" | "UNDETERMINED" | "NOT_APPLICABLE";
export type ClauseOutcome = "APPROVE" | "REVIEW" | "REJECT";

export type UpstreamCallOutcome =
  | "SUCCESS"
  | "HTTP_5XX"
  | "HTTP_4XX"
  | "TIMEOUT"
  | "CONN_RESET"
  | "RATE_LIMITED"
  | "CIRCUIT_OPEN";

export interface CreateApplicationResponse {
  application_id: string;
  status: ApplicationStatus;
}

export interface ApplicationListItem {
  application_id: string;
  application_id_external: string | null;
  status: ApplicationStatus;
  degraded: boolean | null;
  policy: { version: string | null } | null;
  created_at: string;
  decided_at: string | null;
}

export interface ApplicationListResponse {
  items: ApplicationListItem[];
  next_cursor?: string | null;
}

export interface Reason {
  clause_id: string;
  clause_text: string;
  result: ClauseResultKind;
  outcome: ClauseOutcome;
  explanation: string;
  evidence_refs: string[];
  missing_inputs?: string[];
}

export interface UpstreamCallView {
  attempt: number;
  started_at: string;
  duration_ms: number;
  outcome: UpstreamCallOutcome;
  status_code?: number | null;
  retry_after_sec?: number | null;
  error?: string | null;
}

export interface ExtractionFieldView {
  name: string;
  value: string;
  grounded: boolean;
  provenance: { quote: string; source: string } | null;
}

export interface UngroundedFieldView {
  name: string;
  value: string;
  quote: string;
}

export interface ConcernView {
  code: string;
  detail: string;
  quote: string;
}

export interface ExtractionView {
  available: boolean;
  reason: string | null;
  fields?: ExtractionFieldView[];
  ungrounded?: UngroundedFieldView[];
  concerns?: ConcernView[];
  model?: string | null;
  cached?: boolean;
}

export interface ApplicationDetail {
  application_id: string;
  application_id_external?: string | null;
  status: ApplicationStatus;
  created_at: string;
  decided_at?: string | null;
  degraded?: boolean;
  degraded_reasons?: string[];
  policy?: {
    customer: string;
    version: string;
    active_version_now?: string | null;
    resolved?: unknown;
  };
  reasons?: Reason[];
  upstream_calls?: UpstreamCallView[];
  extraction?: ExtractionView | null;
  evidence_hash?: string | null;
  policy_hash?: string | null;
  error?: string | null;
}

export interface HealthResponse {
  status: "ok" | "degraded" | string;
  service: { ok: boolean; db: string };
  upstream: {
    circuit: "CLOSED" | "OPEN" | "HALF_OPEN" | string;
    consecutive_failures: number;
    opened_at: string | null;
    last_success_at: string | null;
    last_failure_at: string | null;
    base_url: string;
  };
  model: {
    reachable: boolean;
    outage_simulated: boolean;
    last_checked_at: string | null;
    model: string | null;
  };
  queue: {
    pending: number;
    processing: number;
    oldest_pending_age_ms: number | null;
  };
}

export interface ZodIssueView {
  path?: (string | number)[];
  message?: string;
  code?: string;
  [k: string]: unknown;
}

export interface ErrorBody {
  error?: string;
  message?: string;
  issues?: ZodIssueView[];
  [k: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody | null;
  readonly raw: string;

  constructor(status: number, body: ErrorBody | null, raw: string) {
    super(body?.error ?? body?.message ?? raw ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.raw = raw;
  }

  get issues(): { path: string; message: string }[] {
    const raw = this.body?.issues;
    if (!Array.isArray(raw)) return [];
    return raw.map((i) => ({
      path: Array.isArray(i.path) && i.path.length ? i.path.join(".") : "(body)",
      message: String(i.message ?? i.code ?? "invalid"),
    }));
  }
}

async function parse(res: Response): Promise<{ body: unknown; raw: string }> {
  const raw = await res.text();
  if (!raw) return { body: null, raw: "" };
  try {
    return { body: JSON.parse(raw), raw };
  } catch {
    return { body: null, raw };
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { apiKey?: string } = {},
): Promise<T> {
  const { apiKey, headers, ...rest } = init;
  const h = new Headers(headers);
  if (apiKey) h.set("X-API-Key", apiKey);
  if (rest.body != null && !h.has("Content-Type")) {
    h.set("Content-Type", "application/json");
  }
  h.set("Accept", "application/json");

  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers: h });
  } catch (e) {
    throw new ApiError(0, { error: "network_error", message: String(e) }, String(e));
  }

  const { body, raw } = await parse(res);
  if (!res.ok) {
    throw new ApiError(res.status, (body as ErrorBody | null) ?? null, raw);
  }
  return body as T;
}

export function createApplication(args: {
  apiKey: string;
  idempotencyKey?: string;
  payload: unknown;
}): Promise<CreateApplicationResponse> {
  const headers: Record<string, string> = {};
  if (args.idempotencyKey) headers["Idempotency-Key"] = args.idempotencyKey;
  return request<CreateApplicationResponse>("/v1/applications", {
    method: "POST",
    apiKey: args.apiKey,
    headers,
    body: JSON.stringify(args.payload),
  });
}

export async function listApplications(
  apiKey: string,
  limit = 20,
): Promise<ApplicationListItem[]> {
  const body = await request<ApplicationListResponse | ApplicationListItem[]>(
    `/v1/applications?limit=${encodeURIComponent(String(limit))}`,
    { apiKey },
  );
  if (Array.isArray(body)) return body;
  return body?.items ?? [];
}

export function getApplication(apiKey: string, id: string): Promise<ApplicationDetail> {
  return request<ApplicationDetail>(`/v1/applications/${encodeURIComponent(id)}`, {
    apiKey,
  });
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/v1/health");
}

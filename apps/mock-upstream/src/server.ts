import express from "express";
import type { Request, Response } from "express";

const RATE_KEYS = [
  "MOCK_FAIL_RATE",
  "MOCK_HANG_RATE",
  "MOCK_RATE_LIMIT_RATE",
] as const;

type RateKey = (typeof RATE_KEYS)[number];
type Rates = Record<RateKey, number>;

const DEFAULT_RATES: Rates = {
  MOCK_FAIL_RATE: 0.3,
  MOCK_HANG_RATE: 0.1,
  MOCK_RATE_LIMIT_RATE: 0.05,
};

const DEFAULT_HANG_SECONDS = 25;
const DEFAULT_PORT = 4000;
const DEFAULT_ADMIN_KEY = "dv_admin_local_only_change_me";

const overrides: Partial<Rates> = {};

function parseRate(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    n = Number(value.trim());
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

function rate(key: RateKey): number {
  const override = overrides[key];
  if (override !== undefined) return override;
  const fromEnv = parseRate(process.env[key]);
  if (fromEnv !== null) return fromEnv;
  return DEFAULT_RATES[key];
}

function currentRates(): Rates {
  return {
    MOCK_FAIL_RATE: rate("MOCK_FAIL_RATE"),
    MOCK_HANG_RATE: rate("MOCK_HANG_RATE"),
    MOCK_RATE_LIMIT_RATE: rate("MOCK_RATE_LIMIT_RATE"),
  };
}

function hangSeconds(): number {
  const n = Number(process.env.MOCK_HANG_SECONDS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_HANG_SECONDS;
}

function adminKey(): string {
  const k = process.env.MOCK_ADMIN_KEY;
  return k && k.length > 0 ? k : DEFAULT_ADMIN_KEY;
}

function maskGstin(v: string): string {
  if (v.length < 6) return "****";
  return v.slice(0, 2) + "****" + v.slice(-4);
}

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), svc: "mock-upstream", event, ...fields }));
}

type KnownRecord = {
  status: string;
  legal_name: string;
  incorporation_date: string;
  registered_address: string;
  filings_annual_turnover_inr: number;
};

const KNOWN: Record<string, KnownRecord> = {
  "29AAFCS4321K1ZP": {
    status: "ACTIVE",
    legal_name: "Saraswati Traders Private Limited",
    incorporation_date: "2023-08-11",
    registered_address:
      "No. 42, 3rd Cross, Peenya Industrial Area, Bengaluru 560058",
    filings_annual_turnover_inr: 10_200_000,
  },
};

const DAY_MS = 86_400_000;
const LAST_RETURN_LAG_DAYS = 41;

function parseAppliedOn(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d
  ) {
    return null;
  }
  return ms;
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

type VerifyBody = {
  gstin: string;
  status: string;
  legal_name: string | null;
  incorporation_date: string | null;
  last_return_filed_on: string | null;
  registered_address: string | null;
  filings_annual_turnover_inr: number | null;
  source: string;
  retrieved_at: string;
};

function successBody(gstin: string, appliedOn: string | undefined): VerifyBody {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const appliedMs = parseAppliedOn(appliedOn) ?? today;
  const known = KNOWN[gstin];
  if (!known) {
    return {
      gstin,
      status: "NOT_FOUND",
      legal_name: null,
      incorporation_date: null,
      last_return_filed_on: null,
      registered_address: null,
      filings_annual_turnover_inr: null,
      source: "mock_gst_registry",
      retrieved_at: now.toISOString(),
    };
  }
  return {
    gstin,
    status: known.status,
    legal_name: known.legal_name,
    incorporation_date: known.incorporation_date,
    last_return_filed_on: toIsoDate(appliedMs - LAST_RETURN_LAG_DAYS * DAY_MS),
    registered_address: known.registered_address,
    filings_annual_turnover_inr: known.filings_annual_turnover_inr,
    source: "mock_gst_registry",
    retrieved_at: now.toISOString(),
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const app = express();

app.disable("x-powered-by");
app.use(express.json({ strict: false }));

const startedAt = Date.now();

app.get("/health", (_req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    service: "mock-upstream",
    status: "ok",
    uptime_s: Math.floor((Date.now() - startedAt) / 1000),
    rates: currentRates(),
  });
});

app.get("/verify", async (req: Request, res: Response) => {
  const gstin = typeof req.query.gstin === "string" ? req.query.gstin : "";
  const appliedOn = typeof req.query.applied_on === "string" ? req.query.applied_on : undefined;

  const hangRate = rate("MOCK_HANG_RATE");
  const rateLimitRate = rate("MOCK_RATE_LIMIT_RATE");
  const failRate = rate("MOCK_FAIL_RATE");

  const r = Math.random();

  if (r < hangRate) {
    const seconds = hangSeconds();
    log("verify.hang", { gstin: maskGstin(gstin), hang_seconds: seconds });
    await sleep(seconds * 1000);
    res.json(successBody(gstin, appliedOn));
    return;
  }

  if (r < hangRate + rateLimitRate) {
    log("verify.rate_limited", { gstin: maskGstin(gstin), status_code: 429 });
    res.setHeader("Retry-After", "5");
    res.status(429).json({ error: "rate_limited" });
    return;
  }

  if (r < hangRate + rateLimitRate + failRate) {
    const failBandStart = hangRate + rateLimitRate;
    const isFiveHundred = r < failBandStart + failRate / 2;

    if (isFiveHundred) {
      log("verify.hard_failure", { gstin: maskGstin(gstin), shape: "http_500", status_code: 500 });
      res.status(500).json({ error: "upstream_error" });
      return;
    }

    log("verify.hard_failure", { gstin: maskGstin(gstin), shape: "truncated_stream", status_code: 200 });
    res.writeHead(200, {
      "content-type": "application/json",
      "content-length": "512",
    });
    res.write('{"gstin":"29AAF');
    setTimeout(() => {
      res.socket?.destroy();
    }, 50);
    return;
  }

  const body = successBody(gstin, appliedOn);
  log("verify.success", { gstin: maskGstin(gstin), status: body.status });
  res.json(body);
});

app.use("/admin", (req: Request, res: Response, next) => {
  if (req.header("X-Admin-Key") !== adminKey()) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
});

app.get("/admin/config", (_req: Request, res: Response) => {
  res.json(currentRates());
});

app.put("/admin/config", (req: Request, res: Response) => {
  const body: unknown = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }

  const patch: Partial<Rates> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!(RATE_KEYS as readonly string[]).includes(key)) {
      res.status(400).json({ error: "unknown_key", key });
      return;
    }
    const parsed = parseRate(value);
    if (parsed === null) {
      res.status(400).json({ error: "invalid_rate", key });
      return;
    }
    patch[key as RateKey] = parsed;
  }

  Object.assign(overrides, patch);
  const rates = currentRates();
  log("admin.config_updated", { rates });
  res.json({ ok: true, rates });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "not_found" });
});

app.use((err: Error, req: Request, res: Response, _next: express.NextFunction) => {
  log("request.error", { path: req.path, error: String(err?.message ?? err) });
  if (res.headersSent) return;
  res.status(500).json({ error: "internal_error" });
});

const portFromEnv = Number(process.env.MOCK_PORT);
const port = Number.isFinite(portFromEnv) && portFromEnv > 0 ? portFromEnv : DEFAULT_PORT;

const server = app.listen(port, () => {
  log("server.started", { port, rates: currentRates(), hang_seconds: hangSeconds() });
});
server.headersTimeout = 0;
server.requestTimeout = 0;
server.setTimeout(0);

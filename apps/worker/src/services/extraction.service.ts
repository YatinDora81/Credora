import { extractionCacheRepository } from "@deepvue/db";
import {
  ExtractionSchema,
  GEMINI_EXTRACTION_SCHEMA,
  SYSTEM_PROMPT,
  buildUserMessage,
  detectInstructionAttempt,
  sha256Hex,
  verifyGrounding,
} from "@deepvue/core";
import type {
  Concern,
  Extraction,
  ExtractionEnvelope,
  ExtractionField,
  ExtractionFieldView,
  ExtractionUnavailableReason,
  QuoteSource,
  UngroundedFieldView,
} from "@deepvue/core";
import { GoogleGenAI } from "@google/genai";
import { config, logger } from "@deepvue/platform";
import { geminiKeys, safeErrorText } from "./gemini-keys";
import { rateLimiterService } from "./rate-limiter.service";

const DEFAULTS = {
  MODEL_NAME: "gemini-2.5-flash",
  MODEL_TIMEOUT_MS: 15_000,
  MODEL_MAX_ATTEMPTS: 2,
  MODEL_RPM_LIMIT: 8,
  MODEL_QUEUE_MAX_WAIT_MS: 20_000,
} as const;

const MAX_QUOTE = 400;

const SINGULAR_FIELDS = [
  "entity_name",
  "incorporation_date",
  "registration_number",
  "turnover_statement",
  "registered_address",
  "operating_address",
] as const;

type SingularField = (typeof SINGULAR_FIELDS)[number];

async function modelName(): Promise<string> {
  try {
    const raw = await config.get("MODEL_NAME");
    const value = (raw ?? "").trim();
    return value || DEFAULTS.MODEL_NAME;
  } catch {
    return DEFAULTS.MODEL_NAME;
  }
}

function clampQuote(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= MAX_QUOTE ? t : t.slice(0, MAX_QUOTE - 3) + "...";
}

function injectionConcern(sourceText: string, modelFlag: boolean): Concern | null {
  const scan = detectInstructionAttempt(sourceText);
  if (!scan.detected && !modelFlag) return null;

  const haystack = sourceText.toLowerCase();
  let best: { index: number; text: string } | null = null;
  for (const needle of scan.matches) {
    const i = haystack.indexOf(needle.toLowerCase());
    if (i < 0) continue;
    if (!best || i < best.index) {
      best = { index: i, text: sourceText.slice(i, i + needle.length) };
    }
  }

  return {
    code: "PROMPT_INJECTION_ATTEMPT",
    detail:
      "Instruction-like text found in the unstructured material" +
      (scan.matches.length > 0
        ? `: ${scan.matches.map((m) => `"${m}"`).join(", ")}`
        : "") +
      `. Scanner: ${scan.detected}; model flag: ${modelFlag}. ` +
      "No policy clause covers document tampering, so this does not change the outcome.",
    quote: clampQuote(best?.text ?? "(flagged by the extractor)"),
  };
}

function unavailableEnvelope(
  reason: ExtractionUnavailableReason,
  model: string | null,
  sourceText: string,
): ExtractionEnvelope {
  const concern = injectionConcern(sourceText, false);
  return {
    available: false,
    reason,
    extraction: null,
    fields: [],
    ungrounded: [],
    concerns: concern ? [concern] : [],
    model,
    cached: false,
  };
}

function quoteSource(quote: string, note: string, document: string): QuoteSource {
  if (verifyGrounding(quote, note)) return "field_agent_note";
  if (verifyGrounding(quote, document)) return "document_text";
  return "combined";
}

function isUsableField(f: unknown): f is ExtractionField {
  return (
    typeof f === "object" &&
    f !== null &&
    typeof (f as ExtractionField).value === "string" &&
    typeof (f as ExtractionField).quote === "string" &&
    (f as ExtractionField).value.trim() !== ""
  );
}

function applyGrounding(
  parsed: Extraction,
  note: string,
  document: string,
): {
  extraction: Extraction;
  fields: ExtractionFieldView[];
  ungrounded: UngroundedFieldView[];
} {
  const sourceText = note + "\n" + document;
  const fields: ExtractionFieldView[] = [];
  const ungrounded: UngroundedFieldView[] = [];

  const keep = (name: string, f: ExtractionField): boolean => {
    if (!verifyGrounding(f.quote, sourceText)) {
      ungrounded.push({ name, value: f.value, quote: clampQuote(f.quote) });
      return false;
    }
    fields.push({
      name,
      value: f.value,
      grounded: true,
      provenance: { quote: f.quote, source: quoteSource(f.quote, note, document) },
    });
    return true;
  };

  const grounded: Extraction = {
    entity_name: null,
    incorporation_date: null,
    registration_number: null,
    turnover_statement: null,
    registered_address: null,
    operating_address: null,
    sectors: [],
    undisclosed_units: [],
    concerns: parsed.concerns ?? [],
    instruction_attempt: parsed.instruction_attempt === true,
  };

  for (const name of SINGULAR_FIELDS) {
    const f = parsed[name as SingularField];
    if (!isUsableField(f)) continue;
    if (keep(name, f)) grounded[name as SingularField] = { value: f.value, quote: f.quote };
  }

  for (const listName of ["sectors", "undisclosed_units"] as const) {
    const list = Array.isArray(parsed[listName]) ? parsed[listName] : [];
    const kept: ExtractionField[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (!isUsableField(f)) continue;
      if (keep(`${listName}[${i}]`, f)) kept.push({ value: f.value, quote: f.quote });
    }
    grounded[listName] = kept;
  }

  return { extraction: grounded, fields, ungrounded };
}

function buildConcerns(parsed: Extraction, note: string, document: string): Concern[] {
  const sourceText = note + "\n" + document;
  const out: Concern[] = [];

  for (const c of parsed.concerns ?? []) {
    if (!c || typeof c.code !== "string" || c.code.trim() === "") continue;
    const quote = typeof c.quote === "string" ? c.quote : "";
    if (!quote || !verifyGrounding(quote, sourceText)) continue;
    if (c.code === "PROMPT_INJECTION_ATTEMPT") continue;
    out.push({
      code: c.code,
      detail: typeof c.detail === "string" ? c.detail : "",
      quote: clampQuote(quote),
    });
  }

  const injection = injectionConcern(sourceText, parsed.instruction_attempt === true);
  if (injection) out.push(injection);

  return out;
}

function finaliseEnvelope(
  parsed: Extraction,
  note: string,
  document: string,
  model: string,
  cached: boolean,
): ExtractionEnvelope {
  const { extraction, fields, ungrounded } = applyGrounding(parsed, note, document);
  return {
    available: true,
    reason: null,
    extraction,
    fields,
    ungrounded,
    concerns: buildConcerns(parsed, note, document),
    model,
    cached,
  };
}

function isRateLimited(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown; message?: unknown } | null;
  if (e && (e.status === 429 || e.code === 429)) return true;
  const text = safeErrorText(err).toUpperCase();
  return (
    text.includes("RESOURCE_EXHAUSTED") ||
    text.includes("429") ||
    text.includes("QUOTA") ||
    text.includes("RATE LIMIT")
  );
}

function isKeyRejected(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown } | null;
  if (e && (e.status === 401 || e.code === 401 || e.status === 403 || e.code === 403)) {
    return true;
  }
  const text = safeErrorText(err).toUpperCase();
  return (
    text.includes("PERMISSION_DENIED") ||
    text.includes("API_KEY_INVALID") ||
    text.includes("API KEY NOT VALID") ||
    text.includes("UNAUTHENTICATED")
  );
}

const KEY_REJECTED_COOLDOWN_MS = 15 * 60_000;

interface ModelCallResult {
  raw: string;
  finishReason: string | null;
}

async function callModel(
  apiKey: string,
  model: string,
  userMessage: string,
  timeoutMs: number,
): Promise<ModelCallResult> {
  const ai = new GoogleGenAI({ apiKey });
  const thinkingBudget = Number(process.env.MODEL_THINKING_BUDGET ?? 0) || 0;

  const res = await ai.models.generateContent({
    model,
    contents: userMessage,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: GEMINI_EXTRACTION_SCHEMA,
      temperature: 0,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: thinkingBudget },
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
  });

  let raw = "";
  try {
    raw = res.text ?? "";
  } catch {
    raw = "";
  }
  const finishReason =
    (res as { candidates?: { finishReason?: string }[] }).candidates?.[0]?.finishReason ?? null;

  return { raw, finishReason: finishReason ?? null };
}

function cacheKey(sourceText: string, model: string): string {
  return sha256Hex(sourceText) + ":" + model;
}

async function readCache(key: string): Promise<Extraction | null> {
  try {
    const stored = await extractionCacheRepository.find(key);
    if (!stored) return null;
    const parsed = ExtractionSchema.safeParse(stored);
    return parsed.success ? parsed.data : null;
  } catch (err) {
    logger.warn({ event: "extraction.cache_read_failed", err: safeErrorText(err) });
    return null;
  }
}

async function writeCache(key: string, model: string, extraction: Extraction): Promise<void> {
  try {
    await extractionCacheRepository.save(key, model, extraction as unknown as object);
  } catch (err) {
    logger.warn({ event: "extraction.cache_write_failed", err: safeErrorText(err) });
  }
}

export class ExtractionService {
  extract = async (
    fieldAgentNote: string,
    documentText: string,
    applicationId: string,
    ): Promise<ExtractionEnvelope> => {
    const note = typeof fieldAgentNote === "string" ? fieldAgentNote : "";
    const document = typeof documentText === "string" ? documentText : "";
    const sourceText = note + "\n" + document;

    const model = await modelName();

    const fail = (reason: ExtractionUnavailableReason): ExtractionEnvelope => {
      logger.warn({ event: "extraction.failed", application_id: applicationId, reason });
      return unavailableEnvelope(reason, model, sourceText);
  };

  const done = (envelope: ExtractionEnvelope): ExtractionEnvelope => {
    logger.info({
      event: "extraction.completed",
      application_id: applicationId,
      available: envelope.available,
      fields: envelope.fields.length,
      ungrounded: envelope.ungrounded.length,
      concerns: envelope.concerns.length,
      cached: envelope.cached,
      model: envelope.model,
    });
    return envelope;
  };

  if (await config.getBool("MODEL_OUTAGE", false)) {
    return fail("MODEL_OUTAGE_SIMULATED");
  }

  if (geminiKeys.size === 0) {
    return fail("MODEL_NOT_CONFIGURED");
  }

  const key = cacheKey(sourceText, model);
  const cacheEnabled = await config.getBool("EXTRACTION_CACHE_ENABLED", true);
  if (cacheEnabled) {
    const hit = await readCache(key);
    if (hit) {
      return done(finaliseEnvelope(hit, note, document, model, true));
    }
  }

  const [timeoutMs, maxAttempts, rpmLimit, queueMaxWaitMs] = await Promise.all([
    config.getPositiveInt("MODEL_TIMEOUT_MS", DEFAULTS.MODEL_TIMEOUT_MS),
    config.getPositiveInt("MODEL_MAX_ATTEMPTS", DEFAULTS.MODEL_MAX_ATTEMPTS),
    config.getPositiveInt("MODEL_RPM_LIMIT", DEFAULTS.MODEL_RPM_LIMIT),
    config.getPositiveInt("MODEL_QUEUE_MAX_WAIT_MS", DEFAULTS.MODEL_QUEUE_MAX_WAIT_MS),
  ]);

  let userMessage = buildUserMessage(note, document);
  let networkAttempts = 0;
  let parseRetryUsed = false;

  const maxIterations = maxAttempts + geminiKeys.size + 2;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const lease = geminiKeys.acquire();
    if (!lease) {
      logger.warn({
        event: "extraction.pool_exhausted",
        application_id: applicationId,
        keys: geminiKeys.size,
        cooling_down: geminiKeys.coolingDown().length,
      });
      return fail("MODEL_RATE_LIMITED");
    }

    const gotToken = await rateLimiterService.acquire(lease.label, {
      capacity: rpmLimit,
      refillPerSec: rpmLimit / 60,
      maxWaitMs: queueMaxWaitMs,
    });
    if (!gotToken) {
      logger.warn({
        event: "extraction.queue_timeout",
        application_id: applicationId,
        key_label: lease.label,
        waited_ms: queueMaxWaitMs,
      });
      return fail("MODEL_RATE_LIMITED");
    }

    let call: ModelCallResult;
    try {
      call = await callModel(lease.key, model, userMessage, timeoutMs);
    } catch (err) {
      const message = safeErrorText(err);

      if (isRateLimited(err)) {
        geminiKeys.cooldown(lease.label);
        logger.warn({
          event: "extraction.key_rate_limited",
          application_id: applicationId,
          key_label: lease.label,
          cooling_down: geminiKeys.coolingDown().length,
          keys: geminiKeys.size,
        });
        continue;
      }

      if (isKeyRejected(err)) {
        geminiKeys.cooldown(lease.label, KEY_REJECTED_COOLDOWN_MS);
        logger.warn({
          event: "extraction.key_rejected",
          application_id: applicationId,
          key_label: lease.label,
          cooling_down: geminiKeys.coolingDown().length,
          keys: geminiKeys.size,
          err: message,
        });
        continue;
      }

      networkAttempts++;
      logger.warn({
        event: "extraction.model_call_failed",
        application_id: applicationId,
        key_label: lease.label,
        attempt: networkAttempts,
        max_attempts: maxAttempts,
        err: message,
      });
      if (networkAttempts >= maxAttempts) return fail("MODEL_UNAVAILABLE");
      continue;
    }

    let json: unknown;
    let parseError: string | null = null;
    try {
      json = JSON.parse(call.raw);
    } catch {
      parseError = `response was not JSON (${call.raw.length} chars, finish_reason=${call.finishReason ?? "none"})`;
    }

    if (parseError === null) {
      const parsed = ExtractionSchema.safeParse(json);
      if (parsed.success) {
        const envelope = finaliseEnvelope(parsed.data, note, document, model, false);
        if (cacheEnabled) await writeCache(key, model, parsed.data);
        return done(envelope);
      }
      parseError = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")
        .slice(0, 1500);
    }

    if (parseRetryUsed) {
      logger.warn({
        event: "extraction.schema_rejected",
        application_id: applicationId,
        retried: true,
        issue_chars: parseError.length,
      });
      return fail("MODEL_OUTPUT_INVALID");
    }

    parseRetryUsed = true;
    logger.warn({
      event: "extraction.schema_rejected",
      application_id: applicationId,
      retried: false,
      issue_chars: parseError.length,
      finish_reason: call.finishReason,
    });
    userMessage =
      buildUserMessage(note, document) +
      `\n\nYour previous response failed schema validation with these errors:\n${parseError}\n` +
      `Return ONLY a JSON object matching the required schema exactly. Every quote must appear verbatim in the input above.`;
  }

  return fail("MODEL_UNAVAILABLE");
  };
}

export const extractionService = new ExtractionService();

import type {
  ApplicationPayload,
  Concern,
  Evidence,
  ExtractionEnvelope,
  Fact,
  FactSource,
  UpstreamResult,
} from "./types";
import type { Extraction, ExtractionField } from "./extraction-schema";
import { normaliseMoney } from "./money";
import { canonicaliseSector } from "./sectors";
import { detectInstructionAttempt } from "./injection";
import { verifyGrounding } from "./grounding";

export interface BuildEvidenceInput {
  payload: ApplicationPayload;
  upstream: UpstreamResult | null;
  extraction: ExtractionEnvelope | null;
}

export interface BuildEvidenceResult {
  evidence: Evidence;
  concerns: Concern[];
}

function fact<T>(value: T, source: FactSource, provenance: string): Fact<T> {
  return { value, available: true, source, provenance };
}

function unavailable(): Fact {
  return { value: null, available: false, source: null, provenance: null };
}

function parseUtcDate(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

function yearOf(raw: string): number | null {
  const parsed = parseUtcDate(raw);
  if (parsed) return parsed.getUTCFullYear();
  const m = /\b(?:19|20)\d{2}\b/.exec(raw);
  return m ? Number(m[0]) : null;
}

function isBlankBlock(s: unknown): boolean {
  if (typeof s !== "string") return true;
  const t = s.trim().toLowerCase();
  return t === "" || t === "n/a" || t === "na";
}

const MAX_QUOTE = 400;
function clampQuote(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= MAX_QUOTE ? t : t.slice(0, MAX_QUOTE - 3) + "...";
}

const GROUP = new Intl.NumberFormat("en-IN");
function group(n: number): string {
  return GROUP.format(Math.round(n));
}

function pct(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1) + "%";
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

const DOT_MASK = "\uE000";

const ABBREVIATIONS = [
  "rs", "no", "nos", "mr", "mrs", "ms", "dr", "pvt", "ltd", "co", "inc",
  "approx", "etc", "vs", "fy", "jan", "feb", "mar", "apr", "jun", "jul",
  "aug", "sep", "sept", "oct", "nov", "dec",
];
const ABBREV_RE = new RegExp(`\\b(${ABBREVIATIONS.join("|")})\\.`, "gi");

function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const masked = line
      .replace(/(\d)\.(\d)/g, `$1${DOT_MASK}$2`)
      .replace(ABBREV_RE, `$1${DOT_MASK}`)
      .replace(/\b([A-Za-z])\./g, `$1${DOT_MASK}`);
    for (const piece of masked.split(/(?<=[.!?])\s+/)) {
      const restored = piece.split(DOT_MASK).join(".").trim();
      if (restored) out.push(restored);
    }
  }
  return out;
}

interface GroundedValue {
  value: string;
  quote: string;
}

function groundedField(
  f: ExtractionField | null | undefined,
  sourceText: string,
): GroundedValue | null {
  if (!f || typeof f.value !== "string" || typeof f.quote !== "string") return null;
  if (!f.value.trim()) return null;
  if (!verifyGrounding(f.quote, sourceText)) return null;
  return { value: f.value, quote: f.quote };
}

function groundedList(
  list: ExtractionField[] | null | undefined,
  sourceText: string,
): GroundedValue[] {
  if (!Array.isArray(list)) return [];
  const out: GroundedValue[] = [];
  for (const f of list) {
    const g = groundedField(f, sourceText);
    if (g) out.push(g);
  }
  return out;
}

export function buildEvidence(input: BuildEvidenceInput): BuildEvidenceResult {
  const { payload, upstream } = input;
  const envelope = input.extraction;

  const extraction: Extraction | null =
    envelope && envelope.available && envelope.extraction ? envelope.extraction : null;

  const note = payload.unstructured?.field_agent_note ?? "";
  const document = payload.unstructured?.document_text ?? "";
  const sourceText = note + "\n" + document;

  const evidence: Evidence = {};
  const concerns: Concern[] = [];

  const appliedOn = parseUtcDate(payload.applied_on);
  evidence.applied_on = appliedOn
    ? fact(appliedOn, "payload", "applied_on")
    : unavailable();

  evidence.loan_amount = fact(payload.loan.amount_inr, "payload", "loan.amount_inr");

  evidence.declared_turnover = fact(
    payload.business.declared_annual_turnover_inr,
    "payload",
    "business.declared_annual_turnover_inr",
  );

  evidence.payload_registered_address = fact(
    payload.business.registered_address,
    "payload",
    "business.registered_address",
  );

  const declaredSectors = dedupeStrings(
    String(payload.business.sector ?? "")
      .split(/[,;/|]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => canonicaliseSector(s))
      .filter((s): s is string => s !== null),
  );
  evidence.declared_sectors = fact(declaredSectors, "payload", "business.sector");

  const upstreamIncorporation = upstream ? parseUtcDate(upstream.incorporation_date) : null;
  const lastReturn = upstream ? parseUtcDate(upstream.last_return_filed_on) : null;

  evidence.gstin_status =
    upstream && typeof upstream.status === "string" && upstream.status
      ? fact(upstream.status, "upstream", "upstream:status")
      : unavailable();

  evidence.last_return_filed = lastReturn
    ? fact(lastReturn, "upstream", "upstream:last_return_filed_on")
    : unavailable();

  evidence.evidenced_turnover =
    upstream && typeof upstream.filings_annual_turnover_inr === "number"
      ? fact(
          upstream.filings_annual_turnover_inr,
          "upstream",
          "upstream:filings_annual_turnover_inr",
        )
      : unavailable();

  evidence.upstream_registered_address =
    upstream &&
    typeof upstream.registered_address === "string" &&
    upstream.registered_address
      ? fact(upstream.registered_address, "upstream", "upstream:registered_address")
      : unavailable();

  const extractedIncorporation = extraction
    ? groundedField(extraction.incorporation_date, sourceText)
    : null;
  const extractedIncorporationDate = extractedIncorporation
    ? parseUtcDate(extractedIncorporation.value)
    : null;

  if (upstreamIncorporation) {
    evidence.incorporation_date = fact(
      upstreamIncorporation,
      "upstream",
      "upstream:incorporation_date",
    );
  } else if (
    upstream !== null &&
    extractedIncorporation &&
    extractedIncorporationDate
  ) {
    evidence.incorporation_date = fact(
      extractedIncorporationDate,
      "extraction",
      extractedIncorporation.quote,
    );
  } else {
    evidence.incorporation_date = unavailable();
  }

  const operatingAddress = extraction
    ? groundedField(extraction.operating_address, sourceText)
    : null;
  evidence.operating_address = operatingAddress
    ? fact(operatingAddress.value, "extraction", operatingAddress.quote)
    : unavailable();

  if (extraction) {
    const units = groundedList(extraction.undisclosed_units, sourceText);
    const unitQuotes = dedupeStrings(units.map((u) => u.quote));
    evidence.undisclosed_units = fact(
      units.map((u) => u.value),
      "extraction",
      unitQuotes.length > 0
        ? unitQuotes.join(" | ")
        : "extraction:undisclosed_units (none)",
    );

    const sectorItems = groundedList(extraction.sectors, sourceText);
    const extractedSectors = dedupeStrings(
      sectorItems
        .map((s) => canonicaliseSector(s.value))
        .filter((s): s is string => s !== null),
    );
    const sectorQuotes = dedupeStrings(sectorItems.map((s) => s.quote));
    evidence.extracted_sectors = fact(
      extractedSectors,
      "extraction",
      sectorQuotes.length > 0 ? sectorQuotes.join(" | ") : "extraction:sectors (none)",
    );
  } else {
    evidence.undisclosed_units = unavailable();
    evidence.extracted_sectors = unavailable();
  }

  evidence.verification_succeeded = fact(
    upstream !== null,
    "derived",
    "derived:verification_succeeded",
  );

  const extractedSectorValues =
    (evidence.extracted_sectors.value as string[] | null) ?? [];
  evidence.all_sectors = fact(
    dedupeStrings([...declaredSectors, ...extractedSectorValues]),
    "derived",
    "derived:all_sectors",
  );

  const upstreamYear = upstreamIncorporation
    ? upstreamIncorporation.getUTCFullYear()
    : null;

  if (upstreamYear !== null && extractedIncorporation) {
    const docYear = yearOf(extractedIncorporation.value);
    if (docYear !== null && docYear !== upstreamYear) {
      concerns.push({
        code: "SOURCE_CONTRADICTION",
        detail:
          `Document states incorporation year ${docYear}; the registry states ` +
          `${upstreamYear}. The registry is authoritative and was used.`,
        quote: clampQuote(extractedIncorporation.quote),
      });
    }
  }

  if (upstreamYear !== null) {
    for (const mention of yearMentions(note)) {
      if (mention.year !== upstreamYear) {
        concerns.push({
          code: "SOURCE_CONTRADICTION",
          detail:
            `Field agent note mentions ${mention.year}; the registry states ` +
            `incorporation ${upstreamYear}. The note is not used as a fact.`,
          quote: clampQuote(mention.quote),
        });
      }
    }
  }

  const declared = payload.business.declared_annual_turnover_inr;
  if (typeof declared === "number" && declared > 0) {
    const candidates: Array<{ text: string; quote: string }> = [];
    const statedTurnover = extraction
      ? groundedField(extraction.turnover_statement, sourceText)
      : null;
    if (statedTurnover) {
      candidates.push({ text: statedTurnover.value, quote: statedTurnover.quote });
    }
    for (const sentence of splitSentences(sourceText)) {
      if (/turnover/i.test(sentence)) candidates.push({ text: sentence, quote: sentence });
    }

    const seenAmounts = new Set<number>();
    for (const candidate of candidates) {
      const money = normaliseMoney(candidate.text);
      if (!money) continue;
      if (seenAmounts.has(money.annualisedInr)) continue;
      seenAmounts.add(money.annualisedInr);
      const variance = (Math.abs(money.annualisedInr - declared) / declared) * 100;
      if (variance > 25) {
        concerns.push({
          code: "TURNOVER_CONTRADICTION",
          detail:
            `Stated turnover annualises to ${group(money.annualisedInr)} against a ` +
            `declared ${group(declared)} — a variance of ${pct(variance)}, beyond ` +
            `the 25% tolerance.`,
          quote: clampQuote(candidate.quote),
        });
      }
    }
  }

  const scan = detectInstructionAttempt(sourceText);
  const modelFlag = extraction ? extraction.instruction_attempt === true : false;
  if (scan.detected || modelFlag) {
    const matched = firstOccurrence(sourceText, scan.matches);
    concerns.push({
      code: "PROMPT_INJECTION_ATTEMPT",
      detail:
        "Instruction-like text found in the unstructured material" +
        (scan.matches.length > 0
          ? `: ${scan.matches.map((m) => `"${m}"`).join(", ")}`
          : "") +
        `. Scanner: ${scan.detected}; model flag: ${modelFlag}. ` +
        "No policy clause covers document tampering, so this does not change the outcome.",
      quote: clampQuote(matched ?? "(flagged by the extractor)"),
    });
  }

  if (isBlankBlock(note) && isBlankBlock(document)) {
    concerns.push({
      code: "NO_UNSTRUCTURED_MATERIAL",
      detail:
        'Both the field agent note and the document text are empty or "n/a"; ' +
        "no document-derived facts could be established.",
      quote: "",
    });
  }

  const carried = envelope?.concerns ?? [];
  return { evidence, concerns: dedupeConcerns([...concerns, ...carried]) };
}

function yearMentions(note: string): { year: number; quote: string }[] {
  const out: { year: number; quote: string }[] = [];
  const seen = new Set<number>();
  const re = /\b(?:19|20)\d{2}\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(note)) !== null) {
    const year = Number(m[0]);
    if (seen.has(year)) continue;
    seen.add(year);
    const before = note.slice(0, m.index).split(/\s+/).filter(Boolean).slice(-4);
    out.push({ year, quote: [...before, m[0]].join(" ") });
  }
  return out;
}

function firstOccurrence(sourceText: string, matches: string[]): string | null {
  const haystack = sourceText.toLowerCase();
  let best: { index: number; text: string } | null = null;
  for (const needle of matches) {
    const i = haystack.indexOf(needle.toLowerCase());
    if (i < 0) continue;
    if (!best || i < best.index) {
      best = { index: i, text: sourceText.slice(i, i + needle.length) };
    }
  }
  return best ? best.text : null;
}

function dedupeConcerns(list: Concern[]): Concern[] {
  const seen = new Set<string>();
  const out: Concern[] = [];
  for (const c of list) {
    if (!c || typeof c.code !== "string") continue;
    const key = c.code + " " + (c.quote ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code: c.code, detail: c.detail ?? "", quote: c.quote ?? "" });
  }
  return out;
}

export type Period = "ANNUAL" | "MONTHLY" | "UNKNOWN";

export interface MoneyResult {
  amountInr: number;
  period: Period;
  annualisedInr: number;
  matchedText: string;
}

const CURRENCY_RE = /₹|\brs\b\.?|\binr\b|\brupees\b/g;

const MONTHLY_RE = /\b(per month|a month|monthly|p\.?m\.?|\/month)\b/;
const ANNUAL_RE = /\b(per annum|annual|annually|p\.?a\.?|\/year|fy ?\d{4})\b/;

const FY_TAIL_RE = /^\s*[-–—/]\s*\d{2,4}/;

const NUMBER_RE = /(\d[\d,]*\.?\d*)/;

const MULTIPLIER_RE =
  /^ ?(crores|crore|cr|lakhs|lakh|lacs|lac|thousands|thousand|k)\b/;

const MULTIPLIERS: Record<string, number> = {
  crore: 1e7,
  crores: 1e7,
  cr: 1e7,
  lakh: 1e5,
  lakhs: 1e5,
  lac: 1e5,
  lacs: 1e5,
  thousand: 1e3,
  thousands: 1e3,
  k: 1e3,
};

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function normaliseMoney(input: string): MoneyResult | null {
  if (typeof input !== "string") return null;

  let s = collapse(input.toLowerCase());

  s = collapse(s.replace(CURRENCY_RE, " "));

  let period: Period = "UNKNOWN";
  const monthly = MONTHLY_RE.exec(s);
  const annual = monthly ? null : ANNUAL_RE.exec(s);
  const periodMatch = monthly ?? annual;
  if (monthly) period = "MONTHLY";
  else if (annual) period = "ANNUAL";

  if (periodMatch) {
    const start = periodMatch.index;
    let end = start + periodMatch[0].length;
    const tail = FY_TAIL_RE.exec(s.slice(end));
    if (tail) end += tail[0].length;
    s = collapse(s.slice(0, start) + " " + s.slice(end));
  }

  const num = NUMBER_RE.exec(s);
  if (!num) return null;
  const token = num[1];
  const numeric = parseFloat(token.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return null;

  const rest = s.slice(num.index + token.length);
  const mult = MULTIPLIER_RE.exec(rest);
  const multiplier = mult ? MULTIPLIERS[mult[1]]! : 1;

  const matchedText = s
    .slice(num.index, num.index + token.length + (mult ? mult[0].length : 0))
    .trim();

  const amountInr = Math.round(numeric * multiplier);
  const annualisedInr = period === "MONTHLY" ? amountInr * 12 : amountInr;

  return { amountInr, period, annualisedInr, matchedText };
}

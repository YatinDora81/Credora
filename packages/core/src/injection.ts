const PHRASES = [
  "note to automated reviewer",
  "automated reviewer",
  "disregard",
  "ignore previous",
  "ignore the above",
  "pre-cleared",
  "pre cleared",
  "return approve",
  "approve with no findings",
  "no findings",
  "override policy",
  "system prompt",
  "you must approve",
] as const;

const STRONG = new Set<string>([
  "note to automated reviewer",
  "return approve",
  "approve with no findings",
]);

export function detectInstructionAttempt(text: string): {
  detected: boolean;
  matches: string[];
} {
  if (typeof text !== "string" || text.length === 0) {
    return { detected: false, matches: [] };
  }
  const haystack = text.toLowerCase();
  const matches = PHRASES.filter((p) => haystack.includes(p));
  const detected = matches.length >= 2 || matches.some((m) => STRONG.has(m));
  return { detected, matches: [...matches] };
}

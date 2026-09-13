export function normaliseForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:'"()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function verifyGrounding(quote: string, sourceText: string): boolean {
  const q = normaliseForMatch(quote);
  if (q.length < 8) return false;
  return normaliseForMatch(sourceText).includes(q);
}

const SECTOR_MAP: ReadonlyArray<readonly [readonly string[], string]> = [
  [
    ["virtual digital asset", "crypto", "cryptocurrency", "bitcoin", "web3 token"],
    "crypto_trading",
  ],
  [["gambling", "betting", "casino", "lottery"], "gambling"],
  [
    ["unregistered lending", "money lending", "chit fund", "unlicensed credit"],
    "unregistered_lending",
  ],
  [["wholesale", "distribution", "trading in goods"], "wholesale_distribution"],
  [["import", "export"], "import_export"],
  [["electronics", "consumer electronics"], "electronics"],
];

export function canonicaliseSector(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase();
  for (const [needles, tag] of SECTOR_MAP) {
    for (const needle of needles) {
      if (s.includes(needle)) return tag;
    }
  }
  return null;
}

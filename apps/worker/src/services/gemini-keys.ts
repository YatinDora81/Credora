const KEY_PATTERN = /AIza[0-9A-Za-z_\-]{10,}/g;

const SPLIT = "__SPLIT__";

export const KEY_COOLDOWN_MS = 60_000;

export function redactKeys(text: string): string {
  return text.replace(KEY_PATTERN, "[REDACTED_API_KEY]");
}

export function safeErrorText(err: unknown): string {
  let raw: string;
  if (err instanceof Error) {
    raw = err.name + ": " + err.message;
  } else if (typeof err === "string") {
    raw = err;
  } else {
    try {
      raw = JSON.stringify(err) ?? String(err);
    } catch {
      raw = String(err);
    }
  }
  return redactKeys(raw ?? "").slice(0, 2000);
}

export interface LeasedKey {
  label: string;
  key: string;
}

interface PoolEntry {
  label: string;
  key: string;
  cooldownUntil: number;
}

function parseEntries(multi: string | undefined, single: string | undefined): PoolEntry[] {
  const out: PoolEntry[] = [];
  const seenKeys = new Set<string>();
  const seenLabels = new Set<string>();

  const push = (rawLabel: string | null, rawKey: string): void => {
    const key = rawKey.trim();
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);
    let label = (rawLabel ?? "").trim();
    if (!label) label = `key_${out.length + 1}`;
    label = redactKeys(label).slice(0, 64);
    let unique = label;
    let n = 2;
    while (seenLabels.has(unique)) unique = `${label}#${n++}`;
    seenLabels.add(unique);
    out.push({ label: unique, key, cooldownUntil: 0 });
  };

  for (const chunk of (multi ?? "").split(",")) {
    const entry = chunk.trim();
    if (!entry) continue;
    const at = entry.indexOf(SPLIT);
    if (at >= 0) {
      push(entry.slice(0, at), entry.slice(at + SPLIT.length));
    } else {
      push(null, entry);
    }
  }

  const fallback = (single ?? "").trim();
  if (fallback) push("GEMINI_API_KEY", fallback);

  return out;
}

class GeminiKeyPool {
  private entries: PoolEntry[] = [];
  private cursor = 0;
  private parsedFrom: string | null = null;

  private sync(): void {
    const multi = process.env.GEMINI_API_KEYS;
    const single = process.env.GEMINI_API_KEY;
    const signature = `${multi ?? ""} ${single ?? ""}`;
    if (this.parsedFrom === signature) return;
    this.parsedFrom = signature;
    const previous = new Map(this.entries.map((e) => [e.key, e.cooldownUntil]));
    this.entries = parseEntries(multi, single).map((e) => ({
      ...e,
      cooldownUntil: previous.get(e.key) ?? 0,
    }));
    this.cursor = 0;
  }

  get size(): number {
    this.sync();
    return this.entries.length;
  }

  labels(): string[] {
    this.sync();
    return this.entries.map((e) => e.label);
  }

  coolingDown(now: number = Date.now()): { label: string; seconds_remaining: number }[] {
    this.sync();
    return this.entries
      .filter((e) => e.cooldownUntil > now)
      .map((e) => ({
        label: e.label,
        seconds_remaining: Math.ceil((e.cooldownUntil - now) / 1000),
      }));
  }

  acquire(now: number = Date.now()): LeasedKey | null {
    this.sync();
    const n = this.entries.length;
    if (n === 0) return null;
    for (let i = 0; i < n; i++) {
      const entry = this.entries[(this.cursor + i) % n]!;
      if (entry.cooldownUntil <= now) {
        this.cursor = (this.cursor + i + 1) % n;
        return { label: entry.label, key: entry.key };
      }
    }
    return null;
  }

  cooldown(label: string, ms: number = KEY_COOLDOWN_MS, now: number = Date.now()): void {
    this.sync();
    const entry = this.entries.find((e) => e.label === label);
    if (!entry) return;
    entry.cooldownUntil = Math.max(entry.cooldownUntil, now + ms);
  }
}

const globalForPool = globalThis as unknown as { __credoraGeminiPool?: GeminiKeyPool };
export const geminiKeys: GeminiKeyPool =
  globalForPool.__credoraGeminiPool ?? new GeminiKeyPool();
globalForPool.__credoraGeminiPool = geminiKeys;

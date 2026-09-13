export interface BucketOptions {
  capacity: number;
  refillPerSec: number;
  maxWaitMs: number;
}

interface Waiter {
  resolve: (granted: boolean) => void;
  deadline: number;
  settled: boolean;
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private capacity: number;
  private refillPerSec: number;
  private readonly queue: Waiter[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: BucketOptions) {
    this.capacity = Math.max(1, opts.capacity);
    this.refillPerSec = Math.max(1e-6, opts.refillPerSec);
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  reconfigure(opts: BucketOptions): void {
    const capacity = Math.max(1, opts.capacity);
    const refillPerSec = Math.max(1e-6, opts.refillPerSec);
    if (capacity === this.capacity && refillPerSec === this.refillPerSec) return;
    this.refill(Date.now());
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = Math.min(this.tokens, this.capacity);
  }

  async acquire(maxWaitMs: number): Promise<boolean> {
    const now = Date.now();
    this.refill(now);

    if (this.queue.length === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    if (maxWaitMs <= 0) return false;

    return new Promise<boolean>((resolve) => {
      this.queue.push({ resolve, deadline: now + maxWaitMs, settled: false });
      this.pump();
    });
  }

  private refill(now: number): void {
    const elapsedMs = now - this.lastRefill;
    if (elapsedMs <= 0) return;
    this.lastRefill = now;
    this.tokens = Math.min(this.capacity, this.tokens + (elapsedMs / 1000) * this.refillPerSec);
  }

  private msToNextToken(now: number): number {
    this.refill(now);
    if (this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) / this.refillPerSec) * 1000);
  }

  private pump(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const now = Date.now();
    this.refill(now);

    while (this.queue.length > 0) {
      const head = this.queue[0]!;
      if (head.settled) {
        this.queue.shift();
        continue;
      }
      if (this.tokens >= 1) {
        this.tokens -= 1;
        this.queue.shift();
        head.settled = true;
        head.resolve(true);
        continue;
      }
      let expiredAny = false;
      for (let i = this.queue.length - 1; i >= 0; i--) {
        const w = this.queue[i]!;
        if (w.deadline <= now) {
          this.queue.splice(i, 1);
          w.settled = true;
          w.resolve(false);
          expiredAny = true;
        }
      }
      if (!expiredAny) break;
    }

    if (this.queue.length === 0) return;

    const head = this.queue[0]!;
    const delay = Math.max(
      5,
      Math.min(this.msToNextToken(now), Math.max(0, head.deadline - now)),
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, delay);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }
}

export class RateLimiterService {
  private readonly buckets = new Map<string, TokenBucket>();

  acquire = (key: string, opts: BucketOptions): Promise<boolean> => {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(opts);
      this.buckets.set(key, bucket);
    } else {
      bucket.reconfigure(opts);
    }
    return bucket.acquire(opts.maxWaitMs);
  };
}

const globalForLimiter = globalThis as unknown as { __deepvueRateLimiter?: RateLimiterService };
export const rateLimiterService: RateLimiterService =
  globalForLimiter.__deepvueRateLimiter ?? new RateLimiterService();
globalForLimiter.__deepvueRateLimiter = rateLimiterService;

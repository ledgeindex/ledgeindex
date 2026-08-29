export class RequestLoopBlockedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("A repeated API request loop was blocked by the client.");
    this.name = "RequestLoopBlockedError";
  }
}

type RequestHistory = {
  attempts: number[];
  blockedUntil: number;
  lastSeenAt: number;
};

export type RequestLoopGuardOptions = {
  maxRequests: number;
  windowMs: number;
  cooldownMs: number;
  maxEntries: number;
};

const DEFAULT_OPTIONS: RequestLoopGuardOptions = {
  maxRequests: 20,
  windowMs: 10_000,
  cooldownMs: 30_000,
  maxEntries: 500,
};

export class RequestLoopGuard {
  private readonly histories = new Map<string, RequestHistory>();

  constructor(
    private readonly options: RequestLoopGuardOptions = DEFAULT_OPTIONS,
  ) {}

  check(key: string, now = Date.now()): void {
    const history = this.histories.get(key) ?? {
      attempts: [],
      blockedUntil: 0,
      lastSeenAt: now,
    };
    history.lastSeenAt = now;
    history.attempts = history.attempts.filter(
      (attemptedAt) => now - attemptedAt < this.options.windowMs,
    );

    if (history.blockedUntil > now) {
      throw new RequestLoopBlockedError(history.blockedUntil - now);
    }
    if (history.attempts.length >= this.options.maxRequests) {
      history.blockedUntil = now + this.options.cooldownMs;
      this.histories.set(key, history);
      throw new RequestLoopBlockedError(this.options.cooldownMs);
    }

    history.attempts.push(now);
    this.histories.set(key, history);
    this.prune(now);
  }

  block(key: string, now = Date.now()): void {
    const history = this.histories.get(key) ?? {
      attempts: [],
      blockedUntil: 0,
      lastSeenAt: now,
    };
    history.blockedUntil = Math.max(
      history.blockedUntil,
      now + this.options.cooldownMs,
    );
    history.lastSeenAt = now;
    this.histories.set(key, history);
    this.prune(now);
  }

  private prune(now: number): void {
    if (this.histories.size <= this.options.maxEntries) return;

    const expiryAge = this.options.windowMs + this.options.cooldownMs;
    for (const [key, history] of this.histories) {
      if (now - history.lastSeenAt > expiryAge) {
        this.histories.delete(key);
      }
    }
    while (this.histories.size > this.options.maxEntries) {
      const oldest = [...this.histories.entries()].sort(
        ([, left], [, right]) => left.lastSeenAt - right.lastSeenAt,
      )[0];
      if (!oldest) return;
      this.histories.delete(oldest[0]);
    }
  }
}

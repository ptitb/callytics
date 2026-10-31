import { createHash } from 'crypto';

export type RunOutcome<T> = { duplicate: true } | { duplicate: false; value: T };

export function dedupeKey(...parts: Array<string | undefined>): string {
  return createHash('sha256').update(parts.map((part) => part ?? '').join('\n')).digest('hex');
}

/**
 * Runs an action at most once per key within a time window.
 *
 * - A key is remembered only after the action succeeded, so a failed attempt can be retried.
 * - A second request that arrives while the first is still running (Callytics times out after
 *   a few seconds and retries) waits for the first one instead of sending a second mail.
 */
export class OncePerWindow {
  private readonly completed = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async run<T>(key: string, action: () => Promise<T>): Promise<RunOutcome<T>> {
    this.prune();
    if (this.completed.has(key)) {
      return { duplicate: true };
    }

    const running = this.inFlight.get(key);
    if (running) {
      // If the first attempt fails this throws too, and the caller answers 5xx so Callytics retries.
      await running;
      return { duplicate: true };
    }

    const promise = action();
    this.inFlight.set(key, promise);
    try {
      const value = await promise;
      this.completed.set(key, this.now());
      return { duplicate: false, value };
    } finally {
      this.inFlight.delete(key);
    }
  }

  private prune(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [key, completedAt] of this.completed) {
      if (completedAt <= cutoff) this.completed.delete(key);
    }
  }
}

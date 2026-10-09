/**
 * Concurrency primitives for turn settlement passes. Each money-move receipt is
 * a chain of dependent journal round trips, so independent settlements run in
 * bounded lanes while writes to one document stay strictly ordered.
 */

/**
 * Run tasks in order across bounded lanes. After any failure no new task
 * starts, every in-flight task is awaited, and the earliest failed task's
 * error is thrown, so no settlement write is left detached behind the throw.
 */
export async function runInLanes<T>(
  items: readonly T[],
  lanes: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const failure: { index: number; error: unknown } = { index: -1, error: undefined };
  const lane = async () => {
    while (failure.index < 0 && next < items.length) {
      const index = next++;
      try {
        await task(items[index]);
      } catch (error) {
        if (failure.index < 0 || index < failure.index) {
          failure.index = index;
          failure.error = error;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(lanes, items.length)) }, lane));
  if (failure.index >= 0) throw failure.error;
}

/**
 * FIFO serialization per key. Every key of one call is queued in the same
 * synchronous step, so waits follow one global order and cannot deadlock.
 * Money-move cash legs guard their target with a revision CAS, so concurrent
 * credits to one Treasury document would exhaust its retries; Treasury writes
 * for a country therefore run one at a time while corporation-only work
 * overlaps.
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<R>(keys: Iterable<string>, fn: () => Promise<R>): Promise<R> {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return fn();
    const prior = unique.map((key) => this.tails.get(key));
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (const key of unique) this.tails.set(key, held);
    try {
      await Promise.all(prior);
      return await fn();
    } finally {
      release();
      for (const key of unique) if (this.tails.get(key) === held) this.tails.delete(key);
    }
  }
}

/**
 * Order work round-robin across buckets, keeping each bucket's input order.
 * Snapshots arrive grouped by country, so a plain queue sent every lane to the
 * same Treasury lock at once and the lanes ran one country at a time.
 */
export function interleaveByKey<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  const queues = [...buckets.values()];
  const ordered: T[] = [];
  for (let round = 0; ordered.length < items.length; round++) {
    for (const queue of queues) if (round < queue.length) ordered.push(queue[round]);
  }
  return ordered;
}

/** Run independent async work with a fixed upper bound and stop scheduling after an error. */
export async function forEachWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const requestedConcurrency = Number.isFinite(concurrency) ? Math.floor(concurrency) : 1;
  const limit = Math.max(1, Math.min(items.length, requestedConcurrency));
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;

  async function runWorker(): Promise<void> {
    while (!failed) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        await worker(items[index]);
      } catch (error) {
        failed = true;
        failure = error;
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  if (failed) throw failure;
}

/** Peak process memory observed while a turn ran, in MiB. */
export interface TurnMemoryPeak {
  peakRssMb: number;
  peakHeapUsedMb: number;
  /** Phase that was running when the heap peak was sampled, if known. */
  peakHeapPhase?: string;
}

const MIB = 1024 * 1024;

/**
 * Sample process memory on an unref'd timer for the life of a turn so turn
 * logs can show whether a change moved peak memory, not just time. Sampling
 * reads counters only; it issues no I/O and cannot keep the process alive.
 */
export function startTurnMemorySampler(
  currentPhase: () => string | null | undefined = () => null,
  intervalMs = 250,
  read: () => Pick<NodeJS.MemoryUsage, "rss" | "heapUsed"> = () => process.memoryUsage()
): () => TurnMemoryPeak {
  let peakRss = 0;
  let peakHeap = 0;
  let peakHeapPhase: string | undefined;
  const sample = () => {
    const usage = read();
    if (usage.rss > peakRss) peakRss = usage.rss;
    if (usage.heapUsed > peakHeap) {
      peakHeap = usage.heapUsed;
      peakHeapPhase = currentPhase() ?? undefined;
    }
  };
  sample();
  const timer = setInterval(sample, intervalMs);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    sample();
    return {
      peakRssMb: Math.round(peakRss / MIB),
      peakHeapUsedMb: Math.round(peakHeap / MIB),
      ...(peakHeapPhase ? { peakHeapPhase } : {}),
    };
  };
}

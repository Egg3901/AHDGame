import { afterEach, describe, expect, it, vi } from "vitest";
import { startTurnMemorySampler } from "./turnMemory";

const MIB = 1024 * 1024;

afterEach(() => vi.useRealTimers());

describe("startTurnMemorySampler", () => {
  it("reports the peak sample and the phase running at the heap peak", () => {
    vi.useFakeTimers();
    const samples = [
      { rss: 100 * MIB, heapUsed: 40 * MIB },
      { rss: 300 * MIB, heapUsed: 90 * MIB },
      { rss: 200 * MIB, heapUsed: 60 * MIB },
      { rss: 150 * MIB, heapUsed: 50 * MIB },
    ];
    const phases = [null, "corporationTurn", "indexFunds", "indexFunds"];
    let index = 0;
    let phase: string | null = null;
    const stop = startTurnMemorySampler(
      () => phase,
      250,
      () => {
        phase = phases[index] ?? null;
        return samples[index++] ?? samples[samples.length - 1];
      }
    );
    vi.advanceTimersByTime(500);
    expect(stop()).toEqual({
      peakRssMb: 300,
      peakHeapUsedMb: 90,
      peakHeapPhase: "corporationTurn",
    });
  });

  it("stops sampling once stopped", () => {
    vi.useFakeTimers();
    const read = vi.fn(() => ({ rss: MIB, heapUsed: MIB }));
    const stop = startTurnMemorySampler(() => null, 250, read);
    stop();
    const calls = read.mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(read.mock.calls.length).toBe(calls);
  });
});

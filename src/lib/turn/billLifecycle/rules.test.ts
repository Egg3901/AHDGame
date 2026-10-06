import { describe, expect, it, vi } from "vitest";
import { resolveRevisionDelay } from "./rules";

describe("resolveRevisionDelay", () => {
  const rule = { chance: 0.25, delayTurnsMin: 1, delayTurnsMax: 2 };

  it("returns null when the revision roll misses", () => {
    expect(resolveRevisionDelay(rule, () => 0.25)).toBeNull();
  });

  it("uses the injected rng for the inclusive delay range", () => {
    const rng = vi.fn().mockReturnValueOnce(0.1).mockReturnValueOnce(0.99);
    expect(resolveRevisionDelay(rule, rng)).toBe(2);
    expect(rng).toHaveBeenCalledTimes(2);
  });
});

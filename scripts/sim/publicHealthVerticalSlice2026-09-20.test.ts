import { describe, expect, it } from "vitest";
import { runPublicHealthVerticalSliceSimulation } from "./publicHealthVerticalSlice2026-09-20";

describe("public-health vertical slice simulation", () => {
  it("passes every proof invariant", () => {
    const result = runPublicHealthVerticalSliceSimulation();
    expect(result.invariants).toEqual({
      everyCaseReconciles: true,
      fundingAndCapacityBindSeparately: true,
      replayHasNoFlow: true,
      repealPreservesEncumbrance: true,
      officeholderNotInAccountIdentity: true,
      serverAndHarnessByteEquivalent: true,
    });
  });
});

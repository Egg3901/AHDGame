import { describe, expect, it } from "vitest";
import { ladderBounds } from "./policyLadder";

describe("ladderBounds", () => {
  it("bounds a three-option ladder at its own last index", () => {
    expect(ladderBounds(3)).toEqual({ maxIndex: 2, centerIndex: 1 });
  });

  it("bounds the common seven-option ladder at 6, centred on 3", () => {
    expect(ladderBounds(7)).toEqual({ maxIndex: 6, centerIndex: 3 });
  });

  it("bounds a new-generation five-level ladder at 4, centred on 2", () => {
    // The new-generation catalog is overwhelmingly five-level, so this is the
    // shape the old hardcoded 0-6 clamp was getting wrong most often in
    // practice: it let an order settle on index 5 or 6, which the enacted-level
    // readback then silently clamps back to 4.
    expect(ladderBounds(5)).toEqual({ maxIndex: 4, centerIndex: 2 });
  });

  it("falls back to the legacy 0-6 ladder when the option count is unknown", () => {
    // A type whose row is missing or carries no options keeps the historical
    // behaviour rather than collapsing to a single index.
    expect(ladderBounds(0)).toEqual({ maxIndex: 6, centerIndex: 3 });
    expect(ladderBounds(undefined)).toEqual({ maxIndex: 6, centerIndex: 3 });
  });

  it("keeps a single-option ladder pinned to its only index", () => {
    expect(ladderBounds(1)).toEqual({ maxIndex: 0, centerIndex: 0 });
  });
});

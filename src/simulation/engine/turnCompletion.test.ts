import { describe, expect, it } from "vitest";

import { completedTurnStatus } from "./turnCompletion";

describe("completedTurnStatus", () => {
  it("keeps advisory warnings without reporting a committed turn as failed", () => {
    expect(completedTurnStatus(["corporationTurn: clearing invariant breach"])).toEqual({
      success: true,
      warningCount: 1,
    });
  });

  it("reports a warning-free committed turn as successful", () => {
    expect(completedTurnStatus([])).toEqual({ success: true, warningCount: 0 });
  });
});

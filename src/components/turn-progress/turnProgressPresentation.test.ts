import { describe, expect, it } from "vitest";
import { describeTurnPhase } from "./turnProgressPresentation";

describe("describeTurnPhase", () => {
  it("groups technical phase names into plain-English work", () => {
    expect(
      describeTurnPhase("presidentialElectionResolution", "Presidential Election Resolution")
    ).toBe("Counting votes and resolving elections");
    expect(describeTurnPhase("corporationProduction", "Corporation Production")).toBe(
      "Updating markets and the economy"
    );
    expect(describeTurnPhase("conflictResolution", "Conflict Resolution")).toBe(
      "Resolving conflicts and military affairs"
    );
  });

  it("falls back to a readable dynamic phase label", () => {
    expect(describeTurnPhase("weather", "Weather Effects")).toBe("Updating weather effects");
    expect(describeTurnPhase(null, null)).toBe("Preparing the next turn");
  });
});

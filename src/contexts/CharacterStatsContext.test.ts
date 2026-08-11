import { describe, it, expect } from "vitest";
import { buildStatusPatch } from "./CharacterStatsContext";

describe("buildStatusPatch", () => {
  it("maps present fields, including actions and campaign funds", () => {
    const patch = buildStatusPatch({
      actions: 7,
      funds: 2_100_000,
      campaignFundsStored: 2_100_000,
      cashOnHand: 5,
      personalHomeLiquid: 5,
    });
    expect(patch.actions).toBe(7);
    expect(patch.campaignFundsStored).toBe(2_100_000);
    expect(patch.personalHomeLiquid).toBe(5);
  });

  it("omits absent fields so a patch never clobbers existing state with undefined", () => {
    const patch = buildStatusPatch({ actions: 3 });
    expect(patch.actions).toBe(3);
    expect("campaignFundsStored" in patch).toBe(false);
    expect("corp" in patch).toBe(false);
    expect("electionStats" in patch).toBe(false);
  });

  it("normalizes corpNav/electionStats nulls into corp/electionStats null", () => {
    const patch = buildStatusPatch({ corpNav: null, electionStats: null });
    expect(patch.corp).toBeNull();
    expect(patch.electionStats).toBeNull();
  });
});

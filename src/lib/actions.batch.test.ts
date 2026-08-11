import { describe, it, expect } from "vitest";
import { simulateActionBatch } from "./actions";
import { makeCharacter } from "@/lib/test-utils/factories";
import type { State } from "@/lib/db/types";

const testState: State = {
  _id: "CA",
  countryId: "US",
  name: "California",
  population: 1_000_000,
  gdp: 65_000,
  houseDistricts: 53,
  stateSenateSeats: 40,
  region: "West",
};

describe("simulateActionBatch", () => {
  it("rejects fundraise without donor base", () => {
    const c = makeCharacter({ donorBaseLevel: 0, actions: 100, funds: 1_000_000 });
    const r = simulateActionBatch(c, undefined, "fundraise", 5);
    expect(r.ok).toBe(false);
  });

  it("staggers campaign costs and PI across multiple runs", () => {
    const c = makeCharacter({
      politicalInfluence: 0,
      actions: 50,
      funds: 10_000_000,
    });
    const r = simulateActionBatch(c, testState, "campaign", 5);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.totalActionPoints).toBe(5);
      expect(r.finalCharacter.politicalInfluence).toBe(5);
      expect(typeof r.netFundsChange).toBe("number");
    }
  });

  it("fails when action points run out mid-batch", () => {
    const c = makeCharacter({
      politicalInfluence: 0,
      actions: 2,
      funds: 10_000_000,
    });
    const r = simulateActionBatch(c, testState, "campaign", 5);
    expect(r.ok).toBe(false);
  });
});

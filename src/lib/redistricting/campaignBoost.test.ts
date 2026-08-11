import { describe, it, expect } from "vitest";
import {
  applyCampaignBoost,
  decayBoostMap,
  CAMPAIGN_BOOST_CAP,
  CAMPAIGN_BOOST_DECAY,
} from "./campaignBoost";

describe("applyCampaignBoost", () => {
  it("accumulates up to the cap", () => {
    expect(applyCampaignBoost(0, 2.5)).toBe(2.5);
    expect(applyCampaignBoost(6, 2.5)).toBe(CAMPAIGN_BOOST_CAP); // 8.5 → 7.5
  });
});

describe("decayBoostMap", () => {
  it("decays every boost toward 0 and prunes empties", () => {
    const out = decayBoostMap({ "1": { "1": 7.5, "2": 0.5 }, "2": { "1": 0.3 } });
    expect(out["1"]["1"]).toBe(7.5 - CAMPAIGN_BOOST_DECAY); // 7.0
    expect(out["1"]["2"]).toBeUndefined(); // 0.5 - 0.5 → 0, pruned
    expect(out["2"]).toBeUndefined(); // 0.3 - 0.5 → 0, district pruned
  });
});

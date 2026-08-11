import { describe, it, expect } from "vitest";
import { calculateCampaignIncome } from "./income";
import type { Campaign } from "@/lib/db/types";

describe("calculateCampaignIncome", () => {
  it("returns base income at level 0", () => {
    const campaign = { fundraisingLevel: 0 } as Campaign;
    expect(calculateCampaignIncome(campaign)).toBe(20_000);
  });

  it("returns correct income at level 5", () => {
    const campaign = { fundraisingLevel: 5 } as Campaign;
    expect(calculateCampaignIncome(campaign)).toBe(200_000);
  });

  it("returns correct income at level 10", () => {
    const campaign = { fundraisingLevel: 10 } as Campaign;
    expect(calculateCampaignIncome(campaign)).toBe(5_000_000);
  });

  it("returns correct income at intermediate levels", () => {
    expect(calculateCampaignIncome({ fundraisingLevel: 1 } as Campaign)).toBe(35_000);
    expect(calculateCampaignIncome({ fundraisingLevel: 3 } as Campaign)).toBe(100_000);
    expect(calculateCampaignIncome({ fundraisingLevel: 7 } as Campaign)).toBe(600_000);
    expect(calculateCampaignIncome({ fundraisingLevel: 9 } as Campaign)).toBe(2_500_000);
  });

  it("clamps out-of-range levels to valid bounds", () => {
    expect(calculateCampaignIncome({ fundraisingLevel: -1 } as Campaign)).toBe(20_000);
    expect(calculateCampaignIncome({ fundraisingLevel: 11 } as Campaign)).toBe(5_000_000);
  });
});

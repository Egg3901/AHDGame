import { describe, it, expect } from "vitest";
import { ACTIONS } from "@/lib/actions";
import type { Character, State } from "@/lib/db/types";
import type { CharacterStats } from "@/lib/stats/statsConstants";

const baseStats: CharacterStats = {
  charisma: 5,
  debate: 5,
  energy: 5,
  fundraising: 5,
  businessAcumen: 5,
  statecraft: 5,
  intellect: 5,
};

function makeChar(stats: Partial<CharacterStats>): Character {
  return {
    donorBaseLevel: 30,
    politicalInfluence: 20,
    favorability: 40,
    countryId: "US",
    stats: { ...baseStats, ...stats },
  } as unknown as Character;
}

const state = {
  name: "Testland",
  gdp: 289_500,
  population: 1_000_000,
} as unknown as State;

describe("stat efficacy hooks on core actions", () => {
  it("Fundraising raises the Fundraise yield", () => {
    const low = ACTIONS.fundraise.effect(makeChar({ fundraising: 1 }));
    const high = ACTIONS.fundraise.effect(makeChar({ fundraising: 10 }));
    expect((high.fundsChange ?? 0) > (low.fundsChange ?? 0)).toBe(true);
  });

  it("Charisma raises Campaign political-influence gain", () => {
    const low = ACTIONS.campaign.effect(makeChar({ charisma: 1 }), state);
    const high = ACTIONS.campaign.effect(makeChar({ charisma: 10 }), state);
    expect((high.politicalInfluenceChange ?? 0) > (low.politicalInfluenceChange ?? 0)).toBe(true);
  });

  it("Intellect lowers Campaign fund cost (less negative)", () => {
    const low = ACTIONS.campaign.effect(makeChar({ intellect: 1 }), state);
    const high = ACTIONS.campaign.effect(makeChar({ intellect: 10 }), state);
    // higher intellect → smaller magnitude cost → fundsChange closer to 0
    expect((high.fundsChange ?? 0) > (low.fundsChange ?? 0)).toBe(true);
  });

  it("Charisma raises Advertise favorability gain", () => {
    const low = ACTIONS.advertise.effect(makeChar({ charisma: 1 }), state);
    const high = ACTIONS.advertise.effect(makeChar({ charisma: 10 }), state);
    expect((high.favorabilityChange ?? 0) >= (low.favorabilityChange ?? 0)).toBe(true);
  });

  it("Intellect lowers Quick Poll cost", () => {
    const low = ACTIONS.poll.effect(makeChar({ intellect: 1 }));
    const high = ACTIONS.poll.effect(makeChar({ intellect: 10 }));
    expect((high.fundsChange ?? 0) > (low.fundsChange ?? 0)).toBe(true);
  });

  it("neutral fallback leaves unmigrated characters near baseline", () => {
    const noStats = {
      donorBaseLevel: 30,
      politicalInfluence: 20,
      countryId: "US",
    } as unknown as Character;
    const result = ACTIONS.fundraise.effect(noStats);
    const neutral = ACTIONS.fundraise.effect(makeChar({ fundraising: 5 }));
    // stat 5 ≈ 0.98×; neutral fallback (5.5) = 1.0×; should be within a few %.
    const a = result.fundsChange ?? 0;
    const b = neutral.fundsChange ?? 0;
    expect(Math.abs(a - b) / a).toBeLessThan(0.05);
  });
});

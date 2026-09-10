/**
 * Difficulty spending discipline in the action AI.
 *
 * The reserve is the one difficulty lever inside this module, and it is
 * one-directional by construction: it can only ever stop an NPP spending. There
 * is no path here that grants an action point, a unit of currency, or a
 * discount — those live in `singleplayerDifficulty/rules/index.ts` and are
 * disclosed to the player as a resource bonus.
 */
import { describe, it, expect } from "vitest";
import { decideNppAction, NPP_FUND_COSTS, type NppActionContext } from "./actionAi";
import { nppBehaviorPolicy } from "@/lib/singleplayerDifficulty/rules/behavior";

const context: NppActionContext = {
  hasOffice: true,
  personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
  funds: 4_000,
  actionPoints: 10,
  donorBaseLevel: 0,
  favorability: 50,
  politicalInfluence: 0,
};

/** Deterministic rng so a decision is a fact, not a coin flip. */
const rng = () => 0.5;

describe("decideNppAction — difficulty funds reserve", () => {
  it("an omitted reserve is the shipped affordability test exactly", () => {
    expect(decideNppAction(context, rng)).toEqual(decideNppAction(context, rng, undefined, {}));
    expect(decideNppAction(context, rng)).toEqual(
      decideNppAction(context, rng, undefined, { fundsReserve: 0 })
    );
  });

  it("normal and easy carry no reserve, so they decide exactly as shipped", () => {
    for (const difficulty of ["easy", "normal"] as const) {
      const policy = nppBehaviorPolicy(difficulty);
      expect(policy.reserveActionMult).toBe(0);
      expect(
        decideNppAction(context, rng, undefined, {
          fundsReserve: policy.reserveActionMult * NPP_FUND_COSTS.advertise,
        })
      ).toEqual(decideNppAction(context, rng));
    }
  });

  it("a disciplined NPP will not spend down past its reserve", () => {
    // 4,000 in hand, advertise costs 3,000, reserve is 3,000: acting would leave
    // 1,000, so it fundraises instead of emptying itself.
    const reserve = nppBehaviorPolicy("hard").reserveActionMult * NPP_FUND_COSTS.advertise;
    const decision = decideNppAction(context, rng, undefined, { fundsReserve: reserve });
    expect(decision.action).toBe("fundraise");
  });

  it("the same NPP acts once it is comfortably above the reserve", () => {
    const reserve = nppBehaviorPolicy("hard").reserveActionMult * NPP_FUND_COSTS.advertise;
    const decision = decideNppAction({ ...context, funds: 50_000 }, rng, undefined, {
      fundsReserve: reserve,
    });
    expect(["campaign", "advertise", "buildDonorBase", "partyDonation"]).toContain(decision.action);
  });

  it("never turns an unaffordable action into an affordable one", () => {
    // Negative or absurd reserves are floored at 0, never used as a discount.
    const broke = { ...context, funds: 0 };
    for (const fundsReserve of [-1_000_000, -1, 0]) {
      expect(decideNppAction(broke, rng, undefined, { fundsReserve }).action).toBe("fundraise");
    }
  });

  it("falls through to fundraising rather than idling when the reserve blocks everything", () => {
    const decision = decideNppAction({ ...context, funds: 3_500 }, rng, undefined, {
      fundsReserve: 1_000_000,
    });
    expect(decision.action).toBe("fundraise");
  });

  it("idles rather than acting when even fundraising is out of reach", () => {
    const decision = decideNppAction(
      { ...context, funds: 3_500, actionPoints: 0 },
      rng,
      undefined,
      { fundsReserve: 1_000_000 }
    );
    expect(decision.action).toBe("none");
  });

  it("consumes no extra rng draws, so a world still replays", () => {
    let draws = 0;
    const counting = () => {
      draws++;
      return 0.5;
    };
    decideNppAction({ ...context, funds: 50_000 }, counting);
    const shipped = draws;
    draws = 0;
    decideNppAction({ ...context, funds: 50_000 }, counting, undefined, { fundsReserve: 3_000 });
    expect(draws).toBe(shipped);
  });
});

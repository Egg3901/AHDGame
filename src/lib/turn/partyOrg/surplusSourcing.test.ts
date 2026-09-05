import { describe, expect, it } from "vitest";
import { sourceFromSurplus, type SurplusPartyView } from "./surplusSourcing";

function view(partyId: string, orgPct: number, regPct: number): SurplusPartyView {
  return { rowId: `row_${partyId}`, partyId, orgPct, regPct };
}

describe("sourceFromSurplus", () => {
  it("draws the shortfall from the only party holding Reg above its Org target", () => {
    const views = [view("climber", 40, 10), view("donor", 20, 50)];
    const climbers = [{ partyId: "climber", rowId: "row_climber", delta: 0.075, newReg: 10.075 }];

    const sourced = sourceFromSurplus(views, climbers, 0.075);

    expect(sourced).toHaveLength(1);
    expect(sourced[0].partyId).toBe("donor");
    expect(sourced[0].delta).toBeCloseTo(-0.075, 10);
    expect(sourced[0].newReg).toBeCloseTo(49.925, 10);
  });

  it("splits the draw between donors in proportion to surplus", () => {
    // small: surplus 10, big: surplus 30 -> 1:3 split of a 0.4 shortfall.
    const views = [view("climber", 40, 10), view("small", 20, 30), view("big", 20, 50)];
    const climbers = [{ partyId: "climber", rowId: "row_climber", delta: 0.4, newReg: 10.4 }];

    const sourced = sourceFromSurplus(views, climbers, 0.4);
    const bySide = Object.fromEntries(sourced.map((d) => [d.partyId, d.delta]));

    expect(bySide.small).toBeCloseTo(-0.1, 10);
    expect(bySide.big).toBeCloseTo(-0.3, 10);
  });

  it("never draws more than the donors' total surplus", () => {
    const views = [view("climber", 90, 0), view("donor", 20, 20.5)];
    const climbers = [{ partyId: "climber", rowId: "row_climber", delta: 5, newReg: 5 }];

    const sourced = sourceFromSurplus(views, climbers, 5);
    const drawn = sourced.reduce((sum, d) => sum - d.delta, 0);

    expect(drawn).toBeCloseTo(0.5, 10);
    expect(sourced[0].newReg).toBeCloseTo(20, 10);
  });

  it("returns nothing when no party sits above its target", () => {
    const views = [view("climber", 40, 10), view("other", 30, 30)];
    const climbers = [{ partyId: "climber", rowId: "row_climber", delta: 0.075, newReg: 10.075 }];

    expect(sourceFromSurplus(views, climbers, 0.075)).toEqual([]);
  });

  it("never sources from a party that is itself climbing", () => {
    // Both are above target, but `climber` is in the climbers list.
    const views = [view("climber", 10, 40), view("donor", 10, 40)];
    const climbers = [{ partyId: "climber", rowId: "row_climber", delta: 0.075, newReg: 40.075 }];

    const sourced = sourceFromSurplus(views, climbers, 0.075);

    expect(sourced.map((d) => d.partyId)).toEqual(["donor"]);
  });

  it("returns nothing for a non-positive shortfall", () => {
    const views = [view("climber", 40, 10), view("donor", 20, 50)];

    expect(sourceFromSurplus(views, [], 0)).toEqual([]);
    expect(sourceFromSurplus(views, [], -1)).toEqual([]);
  });

  it("reduces a relieved donor's contribution by its relief factor", () => {
    // Equal surpluses; the governor's party contributes at (1 - 0.25) weight,
    // so the unrelieved donor covers the larger share of the same shortfall.
    const views = [view("climber", 40, 10), view("gov", 20, 40), view("other", 20, 40)];
    const climbers = [{ partyId: "climber", rowId: "row_climber", delta: 0.4, newReg: 10.4 }];

    const sourced = sourceFromSurplus(views, climbers, 0.4, 0, { partyId: "gov", factor: 0.25 });
    const byParty = Object.fromEntries(sourced.map((d) => [d.partyId, -d.delta]));

    expect(byParty.gov).toBeLessThan(byParty.other);
    expect(byParty.gov + byParty.other).toBeCloseTo(0.4, 10);
  });
});

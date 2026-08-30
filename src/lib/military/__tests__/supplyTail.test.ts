import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { supplyState, planEngagement } from "../battle";
import { ctx, unit, front, FRONTS_MAP } from "./battleFixtures";
import { FRONT_SUPPLY } from "../config";

const T = "afghan";

/**
 * Supply throughput used to be a flat +34 for every formation LABELLED "rear", uncapped
 * and read straight off the player's own role map. Two things followed. A side that
 * labelled enough of its army rear bought perfect supply for nothing — depth still
 * engages at 0.10 and still takes casualties, so the label cost it no fighting power.
 * And a side that labelled nothing sat at CUT OFF no matter how large its tail really
 * was, which is why the top of the supply band was never seen in live play.
 *
 * Depth is now read from the ENGAGEMENT PLAN, which is the authority on who is actually
 * standing behind the line, and it is counted only up to the size of the line it feeds.
 * A tail longer than its teeth is not logistics, it is parking.
 */
const infantry = () =>
  unit({ _id: new ObjectId(), type: "Infantry Division", basePower: 90, theaterId: T });

/** A contingent of `line` formations up front and `depth` behind, by player label. */
function force(line: number, depth: number) {
  const units = Array.from({ length: line + depth }, infantry);
  const positions: Record<string, string> = {};
  units.forEach((u, i) => {
    positions[String(u._id)] = i < line ? "frontline" : "rear";
  });
  return { ...ctx(units), positions };
}

describe("supply tail", () => {
  it("counts depth only up to the size of the line it feeds", () => {
    const matched = supplyState([force(4, 4)], T).throughput;
    const bloated = supplyState([force(4, 20)], T).throughput;
    expect(bloated).toBe(matched);
  });

  it("still rewards a tail that is growing toward the line", () => {
    // The cap must not flatten the whole mechanic: below parity, more depth is more
    // throughput.
    const thin = supplyState([force(8, 2)], T).throughput;
    const fuller = supplyState([force(8, 6)], T).throughput;
    expect(fuller).toBeGreaterThan(thin);
  });

  it("ignores a rear label on a formation the front has in contact", () => {
    // The exploit: label the whole army "rear" and collect throughput for formations
    // that are standing in the line. The plan knows better.
    // Half the roster claims to be depth, which by label alone is a full tooth-to-tail
    // match and pays out. The plan has all six standing in the line, so none of them is
    // feeding anything.
    const c = force(3, 3);

    const plan = planEngagement([c], T, 1_000_000); // roomy: every formation is in contact
    expect(plan.inContact.size).toBe(6);

    const labelled = supplyState([c], T).throughput;
    const planned = supplyState([c], T, plan).throughput;
    expect(planned).toBeLessThan(labelled);
  });

  it("adds a logistics command's haul only for the front region it covers", () => {
    const ordinary = force(4, 2);
    const elsewhere = { ...ordinary, logisticsCoverageByRegion: { angola: 1 } };
    const here = { ...ordinary, logisticsCoverageByRegion: { afghan: 1 } };

    expect(supplyState([elsewhere], T).throughput).toBe(supplyState([ordinary], T).throughput);
    expect(supplyState([here], T).throughput).toBeGreaterThan(
      supplyState([ordinary], T).throughput
    );
  });
});

/**
 * Supply demand used to be every formation's treasury upkeep / 12, whatever it was and
 * wherever it stood, and throughput was a set of flat constants sized for an
 * eleven-formation front. On the live German front (turn 503) that billed the Soviet
 * air arm and rocket forces as 905 of 1,871 demand at a LAND front, charged 52
 * formations in depth as if they were in the line, and made a Logistics command worth
 * +20 against a deficit of ~1,160. The four rules below are measured in
 * scripts/sim/reports/front-supply-2026-08-30.md.
 */
describe("supply demand and throughput scaling", () => {
  const air = () =>
    unit({
      _id: new ObjectId(),
      type: "Fighter Wing",
      domain: "air",
      basePower: 88,
      upkeepBase: 250,
      theaterId: T,
    });

  it("bills an air formation a fraction of its upkeep at a land front", () => {
    const ground = supplyState([ctx([infantry()])], T).demand;
    const flyer = supplyState([ctx([air()])], T).demand;
    // Same upkeepBase would be 250 vs 70; at the share it must land well under the
    // division, not 3.5x above it.
    expect(flyer).toBeLessThan(ground);
    // Rounded once at the end, so allow the half-point.
    expect(
      Math.abs(flyer - Math.round((250 * 2.6) / 12) * FRONT_SUPPLY.offFrontDemand)
    ).toBeLessThanOrEqual(1);
  });

  it("bills a formation the plan leaves in depth a fraction of its upkeep", () => {
    const c = force(6, 0);
    const roomy = planEngagement([c], T, 1_000_000);
    const tight = planEngagement([c], T, 1); // one in contact, five in depth
    expect(tight.inContact.size).toBe(1);
    const allInLine = supplyState([c], T, roomy).demand;
    const mostlyDepth = supplyState([c], T, tight).demand;
    const per = allInLine / 6;
    expect(mostlyDepth).toBeCloseTo(per + 5 * per * FRONT_SUPPLY.depthDemand, 0);
  });

  it("reads depth from the plan, not the player's label, for the discount too", () => {
    const c = force(0, 6); // every formation LABELLED rear
    const roomy = planEngagement([c], T, 1_000_000); // ...but all six in contact
    const labelledOnly = supplyState([c], T).demand;
    const planned = supplyState([c], T, roomy).demand;
    expect(planned).toBeGreaterThan(labelledOnly);
  });

  it("scales a Logistics command with the demand it covers", () => {
    const small = force(4, 2);
    const big = force(16, 8);
    const cover = (c: ReturnType<typeof force>) => ({
      ...c,
      logisticsCoverageByRegion: { afghan: 1 },
    });
    const smallGain =
      supplyState([cover(small)], T).throughput - supplyState([small], T).throughput;
    const bigGain = supplyState([cover(big)], T).throughput - supplyState([big], T).throughput;
    expect(bigGain).toBeGreaterThan(smallGain);
    expect(smallGain).toBeCloseTo(
      supplyState([small], T).demand * FRONT_SUPPLY.logisticsCommandShare,
      0
    );
  });

  it("scales the command's contribution by its effectiveness", () => {
    const c = force(4, 2);
    const full = supplyState([{ ...c, logisticsCoverageByRegion: { afghan: 1 } }], T).throughput;
    const half = supplyState([{ ...c, logisticsCoverageByRegion: { afghan: 0.5 } }], T).throughput;
    const none = supplyState([c], T).throughput;
    expect(Math.abs(half - none - (full - none) / 2)).toBeLessThanOrEqual(1);
  });

  it("hauls more for the side fighting on its own soil", () => {
    const c = force(4, 2);
    const home = { ...c, fronts: { ...FRONTS_MAP, [T]: front(T, { hostSide: "A" }) } };
    const away = { ...c, fronts: { ...FRONTS_MAP, [T]: front(T, { hostSide: "B" }) } };
    const neutral = supplyState([c], T).throughput;
    expect(supplyState([home], T).throughput).toBeCloseTo(
      neutral * FRONT_SUPPLY.hostSideThroughput,
      0
    );
    expect(supplyState([away], T).throughput).toBe(neutral);
  });

  it("applies the home-soil haul before interdiction cuts it", () => {
    const c = force(4, 2);
    const home = { ...c, fronts: { ...FRONTS_MAP, [T]: front(T, { hostSide: "A" }) } };
    const cut = supplyState([home], T, undefined, 0.2).throughput;
    const whole = supplyState([home], T).throughput;
    expect(cut).toBeCloseTo(whole * 0.8, 0);
  });
});

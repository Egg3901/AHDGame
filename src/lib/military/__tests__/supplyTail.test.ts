import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { supplyState, planEngagement } from "../battle";
import { ctx, unit } from "./battleFixtures";

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

  it("adds the logistics command throughput covering the front region", () => {
    const ordinary = force(4, 2);
    const supplied = {
      ...ordinary,
      logisticsSupplyByRegion: { afghan: 20 },
    };

    expect(supplyState([supplied], T).throughput).toBe(supplyState([ordinary], T).throughput + 20);
  });
});

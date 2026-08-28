import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { planEngagement, battleForecast } from "../battle";
import { ctx, side, unit } from "./battleFixtures";
import type { CountryId } from "@/lib/constants/countries";

const T = "afghan";

/**
 * What a formation costs in FRONTAGE is a different question from what it is worth in
 * a FIGHT.
 *
 * Frontage is physical width: how many formations can stand on this ground at once.
 * Combat value measures how good they are. Charging frontage at combat value coupled
 * the two, so readiness — which multiplies combat value — also multiplied a unit's
 * rent on the front. Restoring a worn army's readiness then SHRANK its line, and every
 * fix to readiness silently re-tightened whatever frontage had been calibrated.
 *
 * These tests pin the split: readiness moves strength and never moves the frontage bill.
 */
const roster = (readiness: number, n = 12) =>
  Array.from({ length: n }, () =>
    unit({
      _id: new ObjectId(),
      basePower: 90,
      posture: "alert",
      readiness,
      theaterId: T,
    })
  );

describe("frontage charge", () => {
  it("fits the same number of formations whether they are fresh or worn", () => {
    const fresh = planEngagement([ctx(roster(92))], T, 900);
    const worn = planEngagement([ctx(roster(20))], T, 900);
    expect(worn.inContact.size).toBe(fresh.inContact.size);
  });

  it("still fits fewer of a genuinely heavier formation", () => {
    // The cap must keep meaning something: quality that is not readiness — a better
    // base platform — does still take more room.
    const heavy = planEngagement([ctx(roster(92).map((u) => ({ ...u, basePower: 180 })))], T, 900);
    const light = planEngagement([ctx(roster(92))], T, 900);
    expect(heavy.inContact.size).toBeLessThan(light.inContact.size);
  });

  it("still makes a fresh force fight harder than a worn one", () => {
    // The other half of the split: dropping readiness from the frontage bill must not
    // drop it from the fight.
    const enemy = () => side("CN", "B", [100, 100], T);
    const force = (readiness: number) => {
      const s = side("US", "A", [100], T);
      s.units = roster(readiness).map((u) => ({ ...u, countryId: "US" as CountryId }));
      return s;
    };
    const fresh = battleForecast([force(92)], [enemy()], T);
    const worn = battleForecast([force(20)], [enemy()], T);
    expect(fresh.attStr).toBeGreaterThan(worn.attStr);
  });
});

import { describe, it, expect } from "vitest";
import { battleForecast } from "../battle";
import { side, unit, FRONTS_MAP } from "./battleFixtures";
import type { CountryId } from "@/lib/constants/countries";
import { ObjectId } from "mongodb";

const T = "afghan";

/** A contingent of naval hulls of one type at the front. */
function fleet(country: string, type: string, n: number, seaAccess: boolean) {
  const s = side(country, "A", new Array(n).fill(80), T);
  s.units = s.units.map((u) =>
    unit({
      ...u,
      _id: new ObjectId(),
      countryId: country as CountryId,
      domain: "naval",
      type,
      theaterId: T,
    })
  );
  s.fronts = { ...FRONTS_MAP, [T]: { ...FRONTS_MAP[T]!, seaAccess } };
  return s;
}

describe("naval reach in the battle math", () => {
  it("makes a fleet worth far less inland than on a coast", () => {
    const enemy = side("CN", "B", [100], T);
    const coastal = battleForecast([fleet("US", "Frigate Squadron", 4, true)], [enemy], T);
    const inland = battleForecast([fleet("US", "Frigate Squadron", 4, false)], [enemy], T);
    expect(inland.attStr).toBeLessThan(coastal.attStr);
    // Escorts are 0.40 coastal against 0.10 inland, so roughly a quarter.
    expect(inland.attStr / coastal.attStr).toBeLessThan(0.5);
  });

  it("degrades a carrier inland far more gently than an escort", () => {
    // Compared as RATIOS on purpose. A carrier strike group out-hits a frigate on raw
    // stats alone (atk 95 against 58), so a plain "carrier beats escort" assertion
    // would pass with reach deleted entirely and prove nothing. What reach actually
    // claims is about the SHAPE of the degradation: the carrier keeps half its coastal
    // value inland (1.00 -> 0.50) where the escort keeps a quarter (0.40 -> 0.10).
    const enemy = side("CN", "B", [100], T);
    const keeps = (type: string) => {
      const coastal = battleForecast([fleet("US", type, 3, true)], [enemy], T).attStr;
      const inland = battleForecast([fleet("US", type, 3, false)], [enemy], T).attStr;
      return inland / coastal;
    };
    const carrier = keeps("Carrier Strike Group");
    const escort = keeps("Frigate Squadron");
    expect(carrier).toBeGreaterThan(escort);
    // Roughly 0.50 against 0.25, so the carrier should retain clearly more than 1.5x.
    expect(carrier / escort).toBeGreaterThan(1.5);
  });

  it("leaves a ground force completely unaffected by sea access", () => {
    const enemy = side("CN", "B", [100], T);
    const army = (seaAccess: boolean) => {
      const s = side("US", "A", [120, 90], T);
      s.fronts = { ...FRONTS_MAP, [T]: { ...FRONTS_MAP[T]!, seaAccess } };
      return s;
    };
    const coastal = battleForecast([army(true)], [enemy], T);
    const inland = battleForecast([army(false)], [enemy], T);
    expect(inland.attStr).toBeCloseTo(coastal.attStr, 6);
  });

  it("applies reach to the DEFENDING side too, not just the attacker", () => {
    // The US fleet at the German front is defending. If reach only weighted attackers
    // the whole finding would be untouched.
    const attacker = side("CN", "B", [100], T);
    const coastal = battleForecast([attacker], [fleet("US", "Frigate Squadron", 4, true)], T);
    const inland = battleForecast([attacker], [fleet("US", "Frigate Squadron", 4, false)], T);
    expect(inland.defStr).toBeLessThan(coastal.defStr);
  });
});

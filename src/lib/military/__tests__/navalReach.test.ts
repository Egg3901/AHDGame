import { describe, it, expect } from "vitest";
import { navalReach } from "../combat";
import { NAVAL_REACH } from "../config";

const coastal = { seaAccess: true };
const inland = { seaAccess: false };

describe("navalReach", () => {
  it("leaves every non-naval domain untouched", () => {
    for (const domain of ["ground", "air", "rocket", "space", "marine"]) {
      expect(navalReach(inland, domain, [])).toBe(1);
      expect(navalReach(coastal, domain, ["strategic"])).toBe(1);
    }
  });

  it("lets a carrier air wing work a coastal front at full effect", () => {
    expect(navalReach(coastal, "naval", ["longrange", "antiair", "strategic"])).toBe(
      NAVAL_REACH.coastal.carrier
    );
  });

  it("cuts escorts hard even on a coastal front", () => {
    // Frigates screen the carrier and do sea control; they are not fighting the
    // division inland of them.
    expect(navalReach(coastal, "naval", ["allweather", "antiair"])).toBe(
      NAVAL_REACH.coastal.escort
    );
    expect(NAVAL_REACH.coastal.escort).toBeLessThan(NAVAL_REACH.coastal.carrier);
  });

  it("degrades the carrier inland but does not remove it", () => {
    const reach = navalReach(inland, "naval", ["strategic"]);
    expect(reach).toBe(NAVAL_REACH.inland.carrier);
    expect(reach).toBeGreaterThan(0);
    expect(reach).toBeLessThan(NAVAL_REACH.coastal.carrier);
  });

  it("makes escorts nearly irrelevant inland", () => {
    expect(navalReach(inland, "naval", ["stealth", "antiarmor"])).toBe(NAVAL_REACH.inland.escort);
    expect(NAVAL_REACH.inland.escort).toBeLessThan(0.2);
  });

  it("goes below what terrainFactor could ever return, which is why it is separate", () => {
    expect(navalReach(inland, "naval", [])).toBeLessThan(0.6);
  });

  it("treats an unknown front as inland rather than throwing", () => {
    expect(navalReach(undefined, "naval", ["strategic"])).toBe(NAVAL_REACH.inland.carrier);
  });

  it("survives a missing trait list", () => {
    // The synthetic PvE enemy builds its own trait arrays; a malformed one must not
    // throw inside the hot path.
    expect(navalReach(coastal, "naval", undefined as unknown as string[])).toBe(
      NAVAL_REACH.coastal.escort
    );
  });
});

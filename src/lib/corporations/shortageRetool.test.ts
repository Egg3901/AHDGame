import { describe, expect, it } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import { SHORTAGE_RETOOL_TRANSITION_HEADSTART, shortageRetoolDecision } from "./shortageRetool";

const balances = (entries: Array<[CommodityType, number, number]>) =>
  new Map(entries.map(([c, supply, demand]) => [c, { supply, demand }]));

describe("shortageRetoolDecision", () => {
  it("qualifies a switch into a shortage resource (rare earth at t899 s/d 0.24)", () => {
    const d = shortageRetoolDecision(
      { supply: { rare_earth: 0.6 } },
      balances([["rare_earth", 2404, 9950]])
    );
    expect(d.qualifies).toBe(true);
    expect(d.resource).toBe("rare_earth");
    expect(d.sd).toBeCloseTo(0.2416, 3);
  });

  it("does not qualify glut or balanced destinations (coal s/d 0.71)", () => {
    const d = shortageRetoolDecision(
      { supply: { coal: 0.6 } },
      balances([["coal", 501583, 709028]])
    );
    expect(d.qualifies).toBe(false);
    expect(d.resource).toBeNull();
  });

  it("ignores trace outputs below the min rate", () => {
    const d = shortageRetoolDecision(
      { supply: { energy: 0.6, rare_earth: 0.05 } },
      balances([["rare_earth", 1, 100]])
    );
    expect(d.qualifies).toBe(false);
  });

  it("picks the highest-rate qualifying resource", () => {
    const d = shortageRetoolDecision(
      { supply: { rare_earth: 0.8 } },
      balances([["rare_earth", 2404, 9950]])
    );
    expect(d.qualifies).toBe(true);
    expect(d.resource).toBe("rare_earth");
  });

  it("does not qualify non-extractable outputs or missing balances", () => {
    expect(
      shortageRetoolDecision({ supply: { energy: 0.9 } }, balances([["energy", 1, 100]])).qualifies
    ).toBe(false);
    expect(shortageRetoolDecision({ supply: { rare_earth: 0.9 } }, balances([])).qualifies).toBe(
      false
    );
  });

  it("headstart halves the 12-turn window", () => {
    expect(SHORTAGE_RETOOL_TRANSITION_HEADSTART).toBe(6);
  });
});

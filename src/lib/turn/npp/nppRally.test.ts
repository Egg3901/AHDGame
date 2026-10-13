import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { planNppRally } from "./nppRally";
import type { NppRaceSignal } from "@/lib/npp/actionSignals";

const race = (overrides: Partial<NppRaceSignal> = {}): NppRaceSignal => ({
  candidateRowId: new ObjectId(),
  electionType: "house",
  rallyEligible: true,
  support: 50,
  lastRallyTurn: null,
  ...overrides,
});

describe("NPP engine 6.2 rally", () => {
  it("moves Support by what a player rally in the same race family moves it", () => {
    // house scalar 0.3: R = 10 x 0.3 = 3, 60% now (1.8), 40% over 4 turns (0.3 each).
    const write = planNppRally(race(), 40);
    expect(write?.updateOne.update.$set.support).toBeCloseTo(51.8, 6);
    expect(write?.updateOne.update.$set.lastRallyTurn).toBe(40);
    expect(write?.updateOne.update.$push.supportAccrual.turnsRemaining).toBe(4);
    expect(write?.updateOne.update.$push.supportAccrual.amountPerTurn).toBeCloseTo(0.3, 6);
  });

  it("does not rally outside a rally-eligible active race", () => {
    expect(planNppRally(null, 40)).toBeNull();
    expect(planNppRally(race({ rallyEligible: false }), 40)).toBeNull();
  });

  it("holds the one-rally-per-turn limit players have", () => {
    expect(planNppRally(race({ lastRallyTurn: 40 }), 40)).toBeNull();
    expect(planNppRally(race({ lastRallyTurn: 39 }), 40)).not.toBeNull();
  });

  it("clamps Support at 100", () => {
    expect(planNppRally(race({ support: 99.5 }), 40)?.updateOne.update.$set.support).toBe(100);
  });
});

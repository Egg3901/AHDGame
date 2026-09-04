import { describe, expect, it } from "vitest";
import type { IntelligenceAgency } from "@/lib/db/types/intelligence";
import { OP_SLOTS_PER_TURN } from "./config";
import { slotsRemaining } from "./slots";

function agency(turn: number, remaining: number): IntelligenceAgency {
  return { opSlots: { turn, remaining } } as IntelligenceAgency;
}

describe("slotsRemaining", () => {
  it("treats a stale budget as a full one", () => {
    // Lazy refresh: no turn hook writes these rows, so a budget from an older
    // turn is simply read as full. Same reasoning as DiplomaticActionBudget.
    expect(slotsRemaining(agency(4, 0), 5)).toBe(OP_SLOTS_PER_TURN);
  });

  it("treats a budget from a FUTURE turn as full too, rather than trusting it", () => {
    // A clock rewind must not strand a country with a spent budget forever.
    expect(slotsRemaining(agency(9, 0), 5)).toBe(OP_SLOTS_PER_TURN);
  });

  it("honours a budget already spent this turn", () => {
    expect(slotsRemaining(agency(5, 1), 5)).toBe(1);
  });

  it("never returns a negative count", () => {
    expect(slotsRemaining(agency(5, -3), 5)).toBe(0);
  });

  it("never returns more than the per-turn cap", () => {
    expect(slotsRemaining(agency(5, 999), 5)).toBe(OP_SLOTS_PER_TURN);
  });

  it("treats a missing budget as full", () => {
    expect(slotsRemaining({} as IntelligenceAgency, 5)).toBe(OP_SLOTS_PER_TURN);
  });

  it("treats a non-finite remaining as spent rather than infinite", () => {
    expect(slotsRemaining(agency(5, Number.NaN), 5)).toBe(0);
  });
});

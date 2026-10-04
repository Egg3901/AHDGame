import { describe, expect, it } from "vitest";
import { reconcileRoDelegateCapacity } from "./handover1992";
describe("Romanian capacity custody", () => {
  it("retains party quotas while limiting a player to one seat", () => {
    const result = reconcileRoDelegateCapacity(
      [
        { id: "player", party: "a", seats: 8, isNpc: false },
        { id: "npc", party: "a", seats: 2, isNpc: true },
        { id: "other", party: "b", seats: 10, isNpc: true },
      ],
      10
    );
    expect(result).toEqual({ player: 1, npc: 4, other: 5 });
  });
  it("waits when a party has insufficient individual slate capacity", () => {
    expect(
      reconcileRoDelegateCapacity([{ id: "player", party: "a", seats: 2, isNpc: false }], 2)
    ).toBeNull();
  });
  it("retains a no-holder region without creating a person", () => {
    expect(reconcileRoDelegateCapacity([], 5)).toEqual({});
  });
  it("refuses duplicate or invalid recorded mandates", () => {
    const row = { id: "a", party: "a", seats: 1, isNpc: true };
    expect(() => reconcileRoDelegateCapacity([row, row], 5)).toThrow();
    expect(() => reconcileRoDelegateCapacity([{ ...row, seats: -1 }], 5)).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { bg1991InitiativeSupport } from "./constitutionalInitiative1991";
describe("Bulgarian constituent collective initiative", () => {
  it("requires exactly100 of400 and counts each signature once", () => {
    const officials = Array.from({ length: 400 }, (_, index) => ({
      actor: `player_${index}`,
      seats: 1,
      human: true,
    }));
    const signatures = officials.slice(0, 99).map((row) => row.actor);
    expect(bg1991InitiativeSupport(officials, [...signatures, signatures[0]], 400)).toEqual({
      support: 99,
      required: 100,
      canIntroduce: false,
    });
    expect(
      bg1991InitiativeSupport(officials, [...signatures, officials[99].actor], 400).canIntroduce
    ).toBe(true);
  });
  it("counts NPC slate mandates while retaining a player's single seat", () => {
    const officials = [
      { actor: "npc", seats: 99, human: false },
      { actor: "player", seats: 1, human: true },
    ];
    expect(bg1991InitiativeSupport(officials, ["npc", "player"], 400).support).toBe(100);
    expect(() =>
      bg1991InitiativeSupport([{ actor: "player", seats: 100, human: true }], ["player"], 400)
    ).toThrow("custody");
  });
  it("disregards departed deputies and refuses duplicate player custody", () => {
    expect(bg1991InitiativeSupport([], ["departed"], 400).support).toBe(0);
    expect(() =>
      bg1991InitiativeSupport(
        [
          { actor: "player", seats: 1, human: true },
          { actor: "player", seats: 1, human: true },
        ],
        ["player"],
        400
      )
    ).toThrow("custody");
  });
  it("refuses ordinary capacity, malformed weights and over-capacity signatures", () => {
    expect(() => bg1991InitiativeSupport([], [], 240)).toThrow("400-seat");
    for (const seats of [-1, 0.5, NaN, Infinity, 401])
      expect(() =>
        bg1991InitiativeSupport([{ actor: "npc", seats, human: false }], ["npc"], 400)
      ).toThrow();
  });
});

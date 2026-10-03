import { describe, expect, it } from "vitest";
import { allocateHuModernPeople } from "./modernMandates2011";
describe("Hungarian modern individual mandates", () => {
  it("preserves a199-seat party total while capping the player at one", () => {
    expect(
      allocateHuModernPeople({
        quotas: { a: 199 },
        people: [
          { id: "player", partyId: "a", votes: 999999, isNpc: false },
          { id: "npc", partyId: "a", votes: 1, isNpc: true },
        ],
      })
    ).toEqual({ player: 1, npc: 198 });
  });
  it("defers insufficient people without cloning a player", () => {
    expect(
      allocateHuModernPeople({
        quotas: { a: 2 },
        people: [{ id: "player", partyId: "a", votes: 100, isNpc: false }],
      })
    ).toBeNull();
  });
  it("keeps party quotas and independent identities separate", () => {
    expect(
      allocateHuModernPeople({
        quotas: { a: 100, b: 98, "independent@i": 1 },
        people: [
          { id: "na", partyId: "a", votes: 100, isNpc: true },
          { id: "nb", partyId: "b", votes: 98, isNpc: true },
          { id: "i", partyId: "independent@i", votes: 1, isNpc: false },
        ],
      })
    ).toEqual({ na: 100, nb: 98, i: 1 });
  });
  it("rejects duplicate identities and malformed quotas", () => {
    expect(() => allocateHuModernPeople({ quotas: { a: 200 }, people: [] })).toThrow();
    expect(() =>
      allocateHuModernPeople({
        quotas: {},
        people: [
          { id: "same", partyId: "a", votes: 1, isNpc: true },
          { id: "same", partyId: "a", votes: 1, isNpc: false },
        ],
      })
    ).toThrow();
  });
});

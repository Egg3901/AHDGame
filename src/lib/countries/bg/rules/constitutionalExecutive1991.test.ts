import { describe, expect, it } from "vitest";
import { canBg1991NpcGovernmentIntroduce } from "./constitutionalExecutive1991";
const authority = {
  formed: true,
  playerPrimeMinister: false,
  npcPrimeMinister: true,
  leaderParty: "1",
  capacity: 400,
  mandates: [
    { actor: "npc:bloc", seats: 399, human: false },
    { actor: "human:deputy", seats: 1, human: true },
  ],
};
describe("Bulgarian executive draft authority", () => {
  it("permits a formed NPC government with player deputies without granting an adoption vote", () => {
    expect(canBg1991NpcGovernmentIntroduce(authority)).toBe(true);
  });
  it("permits introduction while valid constituent vacancies remain", () => {
    expect(
      canBg1991NpcGovernmentIntroduce({
        ...authority,
        mandates: [{ actor: "npc:bloc", seats: 100, human: false }],
      })
    ).toBe(true);
  });
  it.each([
    { formed: false },
    { playerPrimeMinister: true },
    { npcPrimeMinister: false },
    { leaderParty: undefined },
    { leaderParty: "" },
    { capacity: 240 },
    { mandates: [] },
    { mandates: [{ actor: "npc:bloc", seats: 0, human: false }] },
    { mandates: [{ actor: "npc:bloc", seats: 401, human: false }] },
    { mandates: [{ actor: "human:deputy", seats: 2, human: true }] },
    {
      mandates: [
        { actor: "human:deputy", seats: 1, human: true },
        { actor: "human:deputy", seats: 1, human: true },
      ],
    },
    { mandates: [{ actor: "", seats: 400, human: false }] },
    { mandates: [{ actor: "npc:bloc", seats: 1.5, human: false }] },
    { mandates: [{ actor: "npc:bloc", seats: -1, human: false }] },
  ])("rejects invalid government or mandate custody %j", (change) => {
    expect(canBg1991NpcGovernmentIntroduce({ ...authority, ...change })).toBe(false);
  });
});

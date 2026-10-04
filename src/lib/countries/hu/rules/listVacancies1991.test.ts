import { describe, expect, it } from "vitest";
import type { Hu1991Mandate, Hu1991Nominations, Hu1991Person } from "./mandates1991";
import { designateHu1991ListReplacement, findHu1991ListVacancies } from "./listVacancies1991";

const person = (id: string, isNpc = true, partyId = "A"): Hu1991Person => ({
  id,
  candidateId: `campaign-${id}`,
  ownerId: isNpc ? "shared-npc-owner" : "player",
  isNpc,
  partyId,
  regionId: "HU_BUD",
});
const people = [
  person("incumbent"),
  person("next"),
  person("last"),
  person("human", false),
  person("other", true, "B"),
];
const nominations: Hu1991Nominations = {
  people,
  constituencies: [],
  territorial: [
    {
      id: "county",
      lists: [{ partyId: "A", candidateIds: ["incumbent", "next", "last", "human"] }],
    },
  ],
  national: [{ partyId: "A", candidateIds: ["incumbent", "next", "last", "human"] }],
};
const mandate: Hu1991Mandate = {
  ...people[0],
  personId: "incumbent",
  tier: "territorial",
  districtId: "county",
};
function vacancies(overrides: Partial<Parameters<typeof findHu1991ListVacancies>[0]> = {}) {
  return findHu1991ListVacancies({
    nominations,
    certifiedMandates: [mandate],
    replacements: [],
    heldPersonIds: new Set(),
    heldPlayerOwnerIds: new Set(),
    unavailablePersonIds: new Set(),
    ...overrides,
  });
}
describe("Hungarian certified party-list vacancy custody", () => {
  it("lets the party choose an originally filed person without changing its mandate", () => {
    const vacancy = vacancies()[0];
    expect(vacancy.eligiblePersonIds).toEqual(["next", "last", "human"]);
    expect(designateHu1991ListReplacement(vacancy, nominations, "last")).toMatchObject({
      personId: "last",
      partyId: "A",
      tier: "territorial",
      districtId: "county",
      regionId: "HU_BUD",
      ownerId: "shared-npc-owner",
    });
    expect(mandate.personId).toBe("incumbent");
  });
  it("rejects another party, an invented person and the departed incumbent", () => {
    for (const id of ["other", "invented", "incumbent"])
      expect(() => designateHu1991ListReplacement(vacancies()[0], nominations, id)).toThrow(
        /original list/
      );
  });
  it("excludes seated people, unavailable people and a player's second mandate", () => {
    expect(
      vacancies({
        heldPersonIds: new Set(["next"]),
        unavailablePersonIds: new Set(["last"]),
        heldPlayerOwnerIds: new Set(["player"]),
      })[0].eligiblePersonIds
    ).toEqual([]);
  });
  it("does not reopen a filled mandate and never replaces a constituency this way", () => {
    expect(vacancies({ heldPersonIds: new Set(["incumbent"]) })).toEqual([]);
    expect(vacancies({ certifiedMandates: [{ ...mandate, tier: "constituency" }] })).toEqual([]);
  });
  it("tracks replacement departures without allowing any former occupant to return", () => {
    const replacements = [
      { slotPersonId: "incumbent", personId: "next" },
      { slotPersonId: "incumbent", personId: "last" },
    ];
    expect(vacancies({ replacements })[0]).toMatchObject({
      previousPersonId: "last",
      eligiblePersonIds: ["human"],
    });
    expect(vacancies({ replacements, heldPersonIds: new Set(["last"]) })).toEqual([]);
  });
  it("uses the original national list and preserves the certified region", () => {
    const vacancy = vacancies({
      certifiedMandates: [
        { ...mandate, tier: "national", districtId: "HU-national", regionId: "HU_WTR" },
      ],
    })[0];
    expect(designateHu1991ListReplacement(vacancy, nominations, "human")).toMatchObject({
      tier: "national",
      regionId: "HU_WTR",
      isNpc: false,
    });
  });
});

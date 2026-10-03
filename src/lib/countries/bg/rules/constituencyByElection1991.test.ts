import { describe, expect, it } from "vitest";
import { BG_1990_CONSTITUENCIES } from "../data/foundingDistricts1990";
import {
  bgGrandAssemblyAllowsPartialElection,
  bgGrandPartialOwnerEligible,
  planBgGrandPartialNpcNominees,
  bgGrandConstituencyRegister,
  bgGrandPartialElectionSchedule,
  countBgGrandPartialElection,
} from "./constituencyByElection1991";
const districtId = BG_1990_CONSTITUENCIES[0].id;
const ballot = {
  registeredVoters: 100,
  ballotsCast: 60,
  invalidBallots: 0,
  options: [
    { personId: "a", votes: 40, tieOrder: 1 },
    { personId: "b", votes: 20, tieOrder: 2 },
  ],
};
describe("Bulgarian Grand Assembly partial-election law", () => {
  it("supplies one party nominee per district and one filing per independent actor", () => {
    const districts = BG_1990_CONSTITUENCIES.filter(
      (row) => row.regionId === BG_1990_CONSTITUENCIES[0].regionId
    ).slice(0, 2);
    const regionId = districts[0].regionId;
    const plan = planBgGrandPartialNpcNominees({
      districtIds: districts.map((row) => row.id),
      registeredPartyIds: new Set(["a"]),
      owners: [
        { ownerId: "a1", partyId: "a", regionId },
        { ownerId: "a2", partyId: "a", regionId },
        { ownerId: "i1", partyId: "independent", regionId },
        { ownerId: "i2", partyId: "independent", regionId },
        { ownerId: "banned", partyId: "b", regionId },
        { ownerId: "executive", partyId: "a", regionId, officeType: "president" },
      ],
    });
    expect(plan.filter((row) => row.partyId === "a")).toHaveLength(2);
    expect(plan.filter((row) => row.partyId === "independent")).toHaveLength(2);
    expect(plan.some((row) => ["banned", "executive", "a2"].includes(row.ownerId))).toBe(false);
  });

  it("distinguishes active, continued and caretaker Grand chambers", () => {
    expect(bgGrandAssemblyAllowsPartialElection({})).toBe(true);
    expect(
      bgGrandAssemblyAllowsPartialElection({
        bgConstitution1991SinceTurn: 25,
        bgGrandAssemblyContinuationSinceTurn: 25,
      })
    ).toBe(true);
    expect(bgGrandAssemblyAllowsPartialElection({ bgConstitution1991SinceTurn: 25 })).toBe(false);
    expect(bgGrandAssemblyAllowsPartialElection({ bgGrandAssemblyDissolutionSinceTurn: 26 })).toBe(
      false
    );
    expect(bgGrandAssemblyAllowsPartialElection({ bgOrdinaryAssemblySinceTurn: 30 })).toBe(false);
    expect(bgGrandAssemblyAllowsPartialElection(null)).toBe(false);
  });
  it("allows multiple NPC people but gives a player only one mandate", () => {
    const owner = {
      ownerExists: true,
      ownerParty: "a",
      candidateParty: "a",
      isNpc: false,
      heldPlayerMandates: 0,
    };
    expect(bgGrandPartialOwnerEligible(owner)).toBe(true);
    expect(bgGrandPartialOwnerEligible({ ...owner, heldPlayerMandates: 1 })).toBe(false);
    expect(bgGrandPartialOwnerEligible({ ...owner, isNpc: true, heldPlayerMandates: 100 })).toBe(
      true
    );
    for (const override of [
      { retired: true },
      { technocrat: true },
      { pendingRelocation: true },
      { ownerParty: "b" },
      { officeType: "president" },
      { ownerExists: false },
    ])
      expect(bgGrandPartialOwnerEligible({ ...owner, ...override })).toBe(false);
  });

  it("gives one month notice and closes nominations at least15 days before polling", () =>
    expect(
      bgGrandPartialElectionSchedule({ turn: 100, vacancyObservedTurn: 100, termEndTurn: 216 })
    ).toEqual({
      startTurn: 100,
      primaryEndTurn: 101,
      endTurn: 104,
      scheduleDeadlineTurn: 108,
      overdue: false,
    }));
  it("allows polling in the last six months when scheduled before the cutoff", () =>
    expect(
      bgGrandPartialElectionSchedule({ turn: 191, vacancyObservedTurn: 190, termEndTurn: 216 })
        ?.endTurn
    ).toBe(195));
  it.each([192, 193, 215, 216])(
    "does not newly schedule at turn%d in the last six months",
    (turn) =>
      expect(
        bgGrandPartialElectionSchedule({ turn, vacancyObservedTurn: 190, termEndTurn: 216 })
      ).toBeNull()
  );
  it("records an overdue scheduling obligation rather than inventing a winner", () =>
    expect(
      bgGrandPartialElectionSchedule({ turn: 110, vacancyObservedTurn: 100, termEndTurn: 216 })
        ?.overdue
    ).toBe(true));
  it("does not turn the scheduling deadline into a polling deadline", () =>
    expect(
      bgGrandPartialElectionSchedule({ turn: 108, vacancyObservedTurn: 100, termEndTurn: 216 })
        ?.endTurn
    ).toBe(112));
  it.each([103, 216])("rejects an invalid polling turn%d", (firstPollTurn) =>
    expect(() =>
      bgGrandPartialElectionSchedule({
        turn: 100,
        vacancyObservedTurn: 100,
        termEndTurn: 216,
        firstPollTurn,
      })
    ).toThrow()
  );
  it("freezes a bounded register from the authoritative regional electorate", () => {
    const first = bgGrandConstituencyRegister(districtId, 1_000_000);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(1_000_000);
    expect(bgGrandConstituencyRegister(districtId, 2_000_000)).toBeGreaterThanOrEqual(2 * first);
  });
  it("elects a strict majority with more than half the register voting", () =>
    expect(countBgGrandPartialElection({ districtId, first: ballot })).toEqual({
      kind: "elected",
      personId: "a",
    }));
  it("renews a low-turnout first round and elects a runoff plurality", () => {
    const first = {
      ...ballot,
      ballotsCast: 40,
      options: [
        { personId: "a", votes: 30, tieOrder: 1 },
        { personId: "b", votes: 10, tieOrder: 2 },
      ],
    };
    expect(countBgGrandPartialElection({ districtId, first })).toMatchObject({ kind: "runoff" });
    expect(
      countBgGrandPartialElection({
        districtId,
        first,
        second: {
          ...first,
          ballotsCast: 3,
          options: [
            { personId: "a", votes: 1, tieOrder: 1 },
            { personId: "b", votes: 2, tieOrder: 2 },
          ],
        },
      })
    ).toEqual({ kind: "elected", personId: "b" });
  });
  it("allows new nominations when a sole candidate fails the first round", () => {
    const first = {
      ...ballot,
      ballotsCast: 40,
      options: [{ personId: "a", votes: 40, tieOrder: 1 }],
    };
    expect(countBgGrandPartialElection({ districtId, first })).toMatchObject({
      kind: "runoff",
      allowNewNominations: true,
    });
    expect(
      countBgGrandPartialElection({
        districtId,
        first,
        second: { ...first, options: [{ personId: "b", votes: 40, tieOrder: 2 }] },
      })
    ).toEqual({ kind: "elected", personId: "b" });
  });
  it("does not invent a deputy from a runoff with no votes", () => {
    const first = {
      ...ballot,
      ballotsCast: 40,
      options: [{ personId: "a", votes: 40, tieOrder: 1 }],
    };
    expect(
      countBgGrandPartialElection({
        districtId,
        first,
        second: { ...first, ballotsCast: 0, options: [] },
      })
    ).toEqual({ kind: "repeat", reason: "no-votes" });
  });
});

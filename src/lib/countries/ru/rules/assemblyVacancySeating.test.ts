import { describe, expect, it } from "vitest";
import { planRussianAssemblyVacancySeating as plan } from "./assemblyVacancySeating";
import type { RussianAssemblySeat } from "./assemblySeating";
const list: RussianAssemblySeat = {
  candidateId: "npc-list",
  ownerId: "npc",
  isNpc: true,
  name: "List",
  party: "1",
  officeType: "dumaDeputy",
  state: "RU",
  seatId: "RU-duma-national-list",
  electionId: "list-poll",
  seatsHeld: 224,
  seatSource: "list",
};
const playerList: RussianAssemblySeat = {
  ...list,
  candidateId: "player-list",
  ownerId: "player",
  isNpc: false,
  seatsHeld: 1,
};
const constituency: RussianAssemblySeat = {
  ...playerList,
  candidateId: "player-const",
  state: "CEN",
  seatId: "RU-duma-CEN-1",
  electionId: "repeat-poll",
  seatSource: "direct",
};
describe("Assembly vacancy seating delta", () => {
  it("preserves held mandates and adds a new winner without cloning profiles", () => {
    const result = plan({
      certified: [list, constituency],
      current: [list],
      previouslySeatedCandidateIds: [list.candidateId],
      unavailableOwners: [],
    });
    expect(result.insert).toEqual([constituency]);
    expect(result.retire).toEqual([]);
    expect(result.update).toEqual([]);
    expect(result.dumaSeats).toBe(225);
  });
  it("moves a winning player from list to constituency and fills their list allocation atomically", () => {
    const result = plan({
      certified: [{ ...list, seatsHeld: 225 }, constituency],
      current: [list, playerList],
      previouslySeatedCandidateIds: [list.candidateId, playerList.candidateId],
      unavailableOwners: [],
    });
    expect(result.retire).toEqual([playerList]);
    expect(result.update).toEqual([{ ...list, seatsHeld: 225 }]);
    expect(result.insert).toEqual([constituency]);
    expect(result.seated.filter((row) => !row.isNpc)).toEqual([constituency]);
    expect(result.dumaSeats).toBe(226);
  });
  it("preserves protected relocation and records an unavailable new mandate", () => {
    const result = plan({
      certified: [list, constituency],
      current: [list],
      previouslySeatedCandidateIds: [list.candidateId],
      unavailableOwners: [{ ownerId: "player", isNpc: false, reason: "pending-relocation" }],
    });
    expect(result.insert).toEqual([]);
    expect(result.vacancies).toEqual([{ ...constituency, reason: "pending-relocation" }]);
    expect(result.seated).toEqual([list]);
  });
  it("does not resurrect a previously ended mandate", () => {
    const result = plan({
      certified: [constituency],
      current: [],
      previouslySeatedCandidateIds: [constituency.candidateId],
      unavailableOwners: [],
    });
    expect(result.insert).toEqual([]);
    expect(result.vacancies[0].reason).toBe("ended-mandate");
  });
  it("leaves additional list seats vacant if their allocated NPC is unavailable", () => {
    const result = plan({
      certified: [{ ...list, seatsHeld: 225 }, constituency],
      current: [list, playerList],
      previouslySeatedCandidateIds: [list.candidateId, playerList.candidateId],
      unavailableOwners: [{ ownerId: "npc", isNpc: true, reason: "retired-owner" }],
    });
    expect(result.update).toEqual([]);
    expect(result.retire).toEqual([playerList]);
    expect(result.vacancies).toEqual([{ ...list, seatsHeld: 1, reason: "retired-owner" }]);
    expect(result.dumaSeats).toBe(225);
  });
  it("fills a journaled deferred list allocation after its owner becomes available", () => {
    const first = plan({
      certified: [{ ...list, seatsHeld: 225 }, constituency],
      current: [list, playerList],
      previouslySeatedCandidateIds: [list.candidateId, playerList.candidateId],
      unavailableOwners: [{ ownerId: "npc", isNpc: true, reason: "retired-owner" }],
    });
    expect(first.deferredListIncreases).toEqual({ "npc-list": 1 });
    const next = plan({
      certified: [{ ...list, seatsHeld: 225 }, constituency],
      current: first.seated,
      previouslySeatedCandidateIds: [
        list.candidateId,
        playerList.candidateId,
        constituency.candidateId,
      ],
      deferredListIncreases: first.deferredListIncreases,
      unavailableOwners: [],
    });
    expect(next.update).toEqual([{ ...list, seatsHeld: 225 }]);
    expect(next.insert).toEqual([]);
    expect(next.deferredListIncreases).toEqual({});
  });
  it.each([
    "remove-held",
    "change-owner",
    "change-source",
    "inflate-list",
    "duplicate-player",
    "chamber-overlap",
  ])("rejects %s", (defect) => {
    const current = [{ ...list }];
    const certified = [{ ...list }, { ...constituency }];
    if (defect === "remove-held") certified.shift();
    if (defect === "change-owner") certified[0].ownerId = "other";
    if (defect === "change-source") certified[0].electionId = "other";
    if (defect === "inflate-list") certified[0].seatsHeld++;
    if (defect === "duplicate-player")
      certified.push({ ...constituency, candidateId: "duplicate", seatId: "other" });
    if (defect === "chamber-overlap")
      certified.push({
        ...constituency,
        candidateId: "council",
        ownerId: "npc",
        isNpc: true,
        officeType: "federationCouncilMember",
      });
    expect(() =>
      plan({ certified, current, previouslySeatedCandidateIds: [], unavailableOwners: [] })
    ).toThrow();
  });
});

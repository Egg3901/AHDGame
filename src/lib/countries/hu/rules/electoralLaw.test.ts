import { describe, expect, it } from "vitest";
import { hu1994DecisionAvailability, passesHuElectoralAmendment } from "./electoralLaw";
import { eligibleHu1991Parties } from "./listAllocation1991";
import { buildHu1991Slates } from "./slates1991";
import {
  HU_1991_CONSTITUENCIES,
  HU_1991_TERRITORIAL_DISTRICTS,
} from "../data/electoralDistricts1991";
import { countHuMixed1991, type Hu1991MixedBallots } from "./mixedElection1991";
import { validateHu1991Nominations } from "./mandates1991";

describe("Hungarian electoral law decisions", () => {
  it.each([
    [{ for: 130, against: 64, abstain: 0 }, true],
    [{ for: 129, against: 65, abstain: 0 }, false],
    [{ for: 193, against: 0, abstain: 0 }, false],
    [{ for: 258, against: 0, abstain: 128 }, true],
    [{ for: 257, against: 0, abstain: 129 }, false],
    [{ for: 200, against: 200, abstain: 0 }, false],
    [{ for: 0, against: 0, abstain: 0 }, false],
    [{ for: 130.5, against: 64, abstain: 0 }, false],
  ])("requires quorum and two-thirds of attendance for %j", (totals, pass) => {
    expect(passesHuElectoralAmendment(totals, 386)).toBe(pass);
  });

  it("dates only open a decision and preserve earlier or modern settlements", () => {
    const base = { preset: "1991-default", calendarTurn: 145 };
    expect(hu1994DecisionAvailability(base)).toEqual({ available: true, reason: "available" });
    expect(hu1994DecisionAvailability({ ...base, calendarTurn: 144 }).reason).toBe("before-date");
    expect(hu1994DecisionAvailability({ ...base, authorizedTurn: 150 }).reason).toBe(
      "already-authorized"
    );
    expect(hu1994DecisionAvailability({ ...base, modernAssemblyYear: 2014 }).reason).toBe(
      "modern-law-in-force"
    );
    expect(hu1994DecisionAvailability({ ...base, preset: "1953-default" }).reason).toBe(
      "other-era"
    );
  });

  it("keeps exact five percent ineligible under 1994 and four percent ineligible under 1989", () => {
    const lists = [
      { partyId: "a", votes: 91, ballotOrder: 1 },
      { partyId: "b", votes: 5, ballotOrder: 2 },
      { partyId: "c", votes: 4, ballotOrder: 3 },
    ];
    expect(eligibleHu1991Parties(lists)).toEqual(["a", "b"]);
    expect(eligibleHu1991Parties(lists, "mixed-1994-v1")).toEqual(["a"]);
  });

  it("uses the ballot's frozen threshold throughout the complete 386-seat count", () => {
    const ballots: Hu1991MixedBallots = {
      constituencies: HU_1991_CONSTITUENCIES.map((row) => ({
        id: row.id,
        first: {
          registeredVoters: 100,
          ballotsCast: 100,
          candidates: [
            { candidateId: `${row.id}:a`, partyId: "a", votes: 60 },
            { candidateId: `${row.id}:b`, partyId: "b", votes: 40 },
          ],
        },
      })),
      territorial: HU_1991_TERRITORIAL_DISTRICTS.map((row) => ({
        id: row.id,
        first: {
          registeredVoters: 100,
          ballotsCast: 100,
          lists: [
            { partyId: "a", votes: 95, ballotOrder: 1 },
            { partyId: "b", votes: 5, ballotOrder: 2 },
          ],
        },
      })),
      nationalLists: [
        { partyId: "a", ballotOrder: 1 },
        { partyId: "b", ballotOrder: 2 },
      ],
    };
    const old = countHuMixed1991(ballots);
    const amended = countHuMixed1991({ ...ballots, electoralLaw: "mixed-1994-v1" });
    expect(old.kind).toBe("counted");
    expect(amended.kind).toBe("counted");
    if (old.kind !== "counted" || amended.kind !== "counted")
      throw new Error("Fixture should finish");
    expect(old.partySeats.b).toBeGreaterThan(0);
    expect(amended.eligibleParties).toEqual(["a"]);
    expect(amended.partySeats.a).toBe(386);
    expect(amended.partySeats.b ?? 0).toBe(0);
    expect(countHuMixed1991(ballots)).toEqual(old);
  });

  it("permits three-times filed slates only with the 1994 law, preserving player identity", () => {
    const actors = [...new Set(HU_1991_TERRITORIAL_DISTRICTS.map((row) => row.regionId))].map(
      (regionId, i) => ({
        id: `${regionId}:npc`,
        ownerId: `${regionId}:owner`,
        regionId,
        partyId: "a",
        isNpc: true,
        filingOrder: i,
      })
    );
    actors.push({
      id: "human",
      ownerId: "human-owner",
      regionId: "HU_BUD",
      partyId: "a",
      isNpc: false,
      filingOrder: 10,
    });
    const filed = buildHu1991Slates(actors, "mixed-1994-v1").nominations;
    expect(filed.national[0].candidateIds).toHaveLength(174);
    expect(filed.people.filter((person) => !person.isNpc)).toHaveLength(1);
    expect(() => validateHu1991Nominations(filed)).not.toThrow();
    expect(() => validateHu1991Nominations({ ...filed, electoralLaw: "mixed-1989-v1" })).toThrow(
      /capacity/
    );
    for (const county of HU_1991_TERRITORIAL_DISTRICTS)
      expect(
        filed.territorial.find((row) => row.id === county.id)!.lists[0].candidateIds
      ).toHaveLength(county.territorialSeats * 3);
  });
});

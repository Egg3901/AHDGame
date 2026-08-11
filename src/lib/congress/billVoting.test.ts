import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import { buildScopedVoteInputs, buildVotesByParty } from "./billVoting";

function makeOfficial(overrides: Partial<ElectedOfficial>): ElectedOfficial {
  return {
    _id: new ObjectId(),
    characterId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ElectedOfficial;
}

describe("buildScopedVoteInputs", () => {
  it("filters foreign same-office voters out of a chamber tally", () => {
    const usNppId = new ObjectId();
    const brNppId = new ObjectId();
    const usKey = `npp_${usNppId.toString()}`;
    const brKey = `npp_${brNppId.toString()}`;

    const { votes, weightMap } = buildScopedVoteInputs(
      {
        [usKey]: "for",
        [brKey]: "against",
      },
      [
        makeOfficial({
          countryId: "US",
          officeType: "senate",
          nppId: usNppId,
          seatsHeld: 2,
        }),
        makeOfficial({
          countryId: "BR",
          officeType: "senate",
          nppId: brNppId,
          seatsHeld: 27,
        }),
      ],
      { countryId: "US", officeType: "senate" }
    );

    expect(votes).toEqual({ [usKey]: "for" });
    expect(weightMap.get(usKey)).toBe(2);
    expect(weightMap.has(brKey)).toBe(false);
  });

  it("filters same-country voters who do not hold the tallied chamber", () => {
    const senatorId = new ObjectId();
    const representativeId = new ObjectId();
    const senatorKey = senatorId.toString();
    const representativeKey = representativeId.toString();

    const { votes } = buildScopedVoteInputs(
      {
        [senatorKey]: "for",
        [representativeKey]: "against",
      },
      [
        makeOfficial({
          countryId: "US",
          officeType: "senate",
          characterId: senatorId,
        }),
        makeOfficial({
          countryId: "US",
          officeType: "house",
          characterId: representativeId,
        }),
      ],
      { countryId: "US", officeType: "senate" }
    );

    expect(votes).toEqual({ [senatorKey]: "for" });
  });

  it("keeps non-chamber vote maps unfiltered when scope is null", () => {
    const voterId = new ObjectId().toString();
    const inputs = buildScopedVoteInputs({ [voterId]: "for" }, [], null);

    expect(inputs.votes).toEqual({ [voterId]: "for" });
    expect(inputs.weightMap.size).toBe(0);
  });

  it("produces party tallies from the scoped vote and weight maps", () => {
    const usNppId = new ObjectId();
    const brNppId = new ObjectId();
    const usKey = `npp_${usNppId.toString()}`;
    const brKey = `npp_${brNppId.toString()}`;
    const partyMap = new Map<string, PoliticalParty>([
      ["1", { sequentialId: 1, name: "Democratic Party", color: "#3366ff" } as PoliticalParty],
      ["3", { sequentialId: 3, name: "Reform Party", color: "#aa33cc" } as PoliticalParty],
    ]);

    const scoped = buildScopedVoteInputs(
      {
        [usKey]: "for",
        [brKey]: "against",
      },
      [
        makeOfficial({ countryId: "US", officeType: "senate", nppId: usNppId, seatsHeld: 2 }),
        makeOfficial({ countryId: "BR", officeType: "senate", nppId: brNppId, seatsHeld: 27 }),
      ],
      { countryId: "US", officeType: "senate" }
    );

    const tally = buildVotesByParty(
      scoped.votes,
      new Map([
        [usKey, "1"],
        [brKey, "3"],
      ]),
      partyMap,
      scoped.weightMap
    );

    expect(tally).toEqual([
      expect.objectContaining({
        party: "1",
        partyName: "Democratic Party",
        for: 2,
        against: 0,
        abstain: 0,
        total: 2,
      }),
    ]);
  });
});

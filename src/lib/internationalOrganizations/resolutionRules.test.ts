import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { resolutionPasses } from "./resolutionRules";
import type { ProposalVoteRecord } from "@/lib/db/types/internationalOrganization";
import type { CountryId } from "@/lib/constants/countries";

function vote(countryId: CountryId, v: "yes" | "no" | "abstain"): ProposalVoteRecord {
  return {
    countryId,
    characterId: new ObjectId(),
    characterName: `${countryId} FM`,
    vote: v,
    castAt: new Date(),
    castOnTurn: 1,
  };
}

describe("resolutionPasses", () => {
  it("FTA passes only with unanimous yes from every named party", () => {
    expect(
      resolutionPasses({
        type: "free_trade_agreement",
        members: ["US", "UK", "DE"],
        parties: ["US", "UK"],
        votes: [vote("US", "yes"), vote("UK", "yes")],
      })
    ).toBe(true);
  });

  it("FTA fails when a party abstains or does not vote", () => {
    expect(
      resolutionPasses({
        type: "free_trade_agreement",
        members: ["US", "UK", "DE"],
        parties: ["US", "UK"],
        votes: [vote("US", "yes"), vote("UK", "abstain")],
      })
    ).toBe(false);
  });

  it("non-FTA passes on simple majority of members voting", () => {
    expect(
      resolutionPasses({
        type: "sanctions",
        members: ["US", "UK", "DE"],
        parties: [],
        votes: [vote("US", "yes"), vote("UK", "yes"), vote("DE", "no")],
      })
    ).toBe(true);
  });

  it("non-FTA fails on a tie and on zero turnout", () => {
    expect(
      resolutionPasses({
        type: "sanctions",
        members: ["US", "UK"],
        parties: [],
        votes: [vote("US", "yes"), vote("UK", "no")],
      })
    ).toBe(false);
    expect(
      resolutionPasses({ type: "directive", members: ["US", "UK"], parties: [], votes: [] })
    ).toBe(false);
  });

  it("a permanent member's no vetoes an otherwise-passing resolution", () => {
    expect(
      resolutionPasses({
        type: "sanctions",
        members: ["US", "UK", "DE", "JP"],
        parties: [],
        votes: [vote("UK", "yes"), vote("DE", "yes"), vote("JP", "yes"), vote("US", "no")],
        permanentMembers: ["US", "UK", "DE", "JP"],
      })
    ).toBe(false);
  });

  it("a non-permanent member's no does not veto", () => {
    expect(
      resolutionPasses({
        type: "sanctions",
        members: ["US", "DE", "BR"],
        parties: [],
        votes: [vote("US", "yes"), vote("DE", "yes"), vote("BR", "no")],
        permanentMembers: ["US"],
      })
    ).toBe(true);
  });

  it("non-FTA ignores votes from non-members", () => {
    expect(
      resolutionPasses({
        type: "directive",
        members: ["US"],
        parties: [],
        votes: [vote("US", "yes"), vote("DE", "no"), vote("UK", "no")],
      })
    ).toBe(true);
  });
});

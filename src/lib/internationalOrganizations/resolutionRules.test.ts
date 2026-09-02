import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  ballotPasses,
  dedupeOrganizationVotes,
  ballotIsPlayerOnly,
  requiresUnanimity,
  resolutionPasses,
  votesNeeded,
} from "./resolutionRules";
import type { ProposalVoteRecord } from "@/lib/db/types/internationalOrganization";
import type { CountryId } from "@/lib/constants/countries";
import type { OrgBallotKind } from "./resolutionRules";

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

/** Every ballot kind the game runs. Keep in step with `OrgBallotKind`. */
const ORG_BALLOT_KINDS: OrgBallotKind[] = [
  "free_trade_agreement",
  "sanctions",
  "directive",
  "joint_statement",
  "aid_package",
  "set_dues",
  "set_posture",
  "fund_agency",
  "join_conflict",
  "membership_proposal",
  "leadership_election",
];

describe("votesNeeded", () => {
  it("requires the whole ballot for the unanimous kinds", () => {
    expect(votesNeeded("join_conflict", 4)).toBe(4);
    expect(votesNeeded("free_trade_agreement", 2)).toBe(2);
    expect(votesNeeded("membership_proposal", 3)).toBe(3);
  });

  it("requires more than half the ballot for the majority kinds", () => {
    expect(votesNeeded("sanctions", 4)).toBe(3);
    expect(votesNeeded("sanctions", 3)).toBe(2);
    expect(votesNeeded("directive", 1)).toBe(1);
    expect(votesNeeded("leadership_election", 2)).toBe(2);
  });
});

describe("requiresUnanimity", () => {
  it("covers war entry, trade agreements and admissions", () => {
    expect(requiresUnanimity("join_conflict")).toBe(true);
    expect(requiresUnanimity("free_trade_agreement")).toBe(true);
    expect(requiresUnanimity("membership_proposal")).toBe(true);
  });

  it("excludes the routine instruments and leadership elections", () => {
    expect(requiresUnanimity("sanctions")).toBe(false);
    expect(requiresUnanimity("aid_package")).toBe(false);
    expect(requiresUnanimity("leadership_election")).toBe(false);
  });
});

describe("ballotIsPlayerOnly", () => {
  it("covers the admission and the bloc war entry", () => {
    expect(ballotIsPlayerOnly("membership_proposal")).toBe(true);
    expect(ballotIsPlayerOnly("join_conflict")).toBe(true);
  });

  it("leaves the free trade agreement on the wider roll, unanimous though it is", () => {
    // The two questions are NOT the same, and the FTA is the whole reason. It
    // is voted only by its named parties, each ratifying an agreement it is
    // itself signing, so narrowing it would leave a deal between two modelled
    // neighbours with nobody entitled to vote at all.
    expect(requiresUnanimity("free_trade_agreement")).toBe(true);
    expect(ballotIsPlayerOnly("free_trade_agreement")).toBe(false);
  });

  it("leaves majority business on the wider roll", () => {
    expect(ballotIsPlayerOnly("sanctions")).toBe(false);
    expect(ballotIsPlayerOnly("leadership_election")).toBe(false);
  });

  it("forces a decision about any NEW unanimous ballot kind", () => {
    // THE TRAP THIS GUARDS. A ballot decided by unanimity where a member is
    // judging someone ELSE's business must be player-only, or an autonomous
    // member's silence vetoes it forever — that is ticket #1257 exactly. A new
    // unanimous kind added to UNANIMOUS_KINDS would otherwise default to the
    // wider roll and recreate the deadlock silently.
    //
    // If you are adding one, decide which side it is on and update this list.
    // The FTA is the only unanimous kind that legitimately stays wide.
    const unanimousButWide = ORG_BALLOT_KINDS.filter(
      (kind) => requiresUnanimity(kind) && !ballotIsPlayerOnly(kind)
    );
    expect(unanimousButWide).toEqual(["free_trade_agreement"]);
  });
});

describe("dedupeOrganizationVotes", () => {
  it("keeps only the latest row for a country that voted more than once", () => {
    // Historical rows in the live data carry duplicates. The resolver has always
    // folded them; the panels must fold them the same way or they disagree.
    const folded = dedupeOrganizationVotes([
      vote("US", "yes"),
      vote("UK", "yes"),
      vote("US", "no"),
    ]);

    expect(folded).toHaveLength(2);
    expect(folded.find((v) => v.countryId === "US")?.vote).toBe("no");
  });

  it("leaves a clean ballot untouched", () => {
    expect(dedupeOrganizationVotes([vote("US", "yes"), vote("UK", "no")])).toHaveLength(2);
  });
});

describe("ballotPasses", () => {
  it("cannot pass a ballot with no eligible voters", () => {
    expect(ballotPasses("membership_proposal", 0, 0)).toBe(false);
    expect(ballotPasses("sanctions", 0, 0)).toBe(false);
  });
});

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

  it("majority resolution passes when yes exceeds half the voting roll", () => {
    expect(
      resolutionPasses({
        type: "sanctions",
        members: ["US", "UK", "DE"],
        parties: [],
        votes: [vote("US", "yes"), vote("UK", "yes"), vote("DE", "no")],
      })
    ).toBe(true);
  });

  it("majority resolution counts the roll, not the votes cast", () => {
    expect(
      resolutionPasses({
        type: "sanctions",
        members: ["US", "UK", "DE"],
        parties: [],
        votes: [vote("US", "yes")],
      })
    ).toBe(false);
  });

  it("majority resolution treats an abstention as a nay", () => {
    expect(
      resolutionPasses({
        type: "directive",
        members: ["US", "UK", "DE"],
        parties: [],
        votes: [vote("US", "yes"), vote("UK", "abstain"), vote("DE", "abstain")],
      })
    ).toBe(false);
  });

  it("majority resolution fails on a tie and on zero turnout", () => {
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

  it("join_conflict passes only when every voting member votes yes", () => {
    expect(
      resolutionPasses({
        type: "join_conflict",
        members: ["US", "UK"],
        parties: [],
        votes: [vote("US", "yes"), vote("UK", "yes")],
      })
    ).toBe(true);
  });

  it("join_conflict fails when a voting member stays silent", () => {
    expect(
      resolutionPasses({
        type: "join_conflict",
        members: ["US", "UK"],
        parties: [],
        votes: [vote("US", "yes")],
      })
    ).toBe(false);
  });

  it("join_conflict fails when a voting member abstains", () => {
    expect(
      resolutionPasses({
        type: "join_conflict",
        members: ["US", "UK"],
        parties: [],
        votes: [vote("US", "yes"), vote("UK", "abstain")],
      })
    ).toBe(false);
  });

  it("join_conflict cannot pass on an empty roll", () => {
    expect(resolutionPasses({ type: "join_conflict", members: [], parties: [], votes: [] })).toBe(
      false
    );
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

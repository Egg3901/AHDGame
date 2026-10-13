import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { NPP } from "@/lib/db/types";
import { hasTheVotes, projectChamberVote, type WhipCountInput } from "./whipCount";

const npp = (party: string, economic: number): NPP =>
  ({
    _id: new ObjectId(),
    party,
    homeState: "CA",
    policies: { economic, social: 0 },
    personality: { loyalty: 80, ambition: 50, stubbornness: 20 },
  }) as unknown as NPP;

const base = (overrides: Partial<WhipCountInput> = {}): WhipCountInput => ({
  bill: {
    provisions: [
      {
        legislationTypeId: "t",
        policyOptionId: "right",
        effectDirection: 1,
        economic: 3,
        social: 0,
      },
    ],
  },
  legislationType: null,
  sponsorParty: "gov",
  voters: [],
  playerSeatsByParty: {},
  demographicsByState: new Map(),
  opposition: null,
  oppositionCoordination: 1,
  ...overrides,
});

describe("NPP engine 6.5 whip count", () => {
  it("counts aligned co-partisans for and opposed rivals against, by seats", () => {
    const count = projectChamberVote(
      base({
        voters: [
          { npp: npp("gov", 3), seats: 6 },
          { npp: npp("opp", -4), seats: 4 },
        ],
      })
    );
    expect(count.forSeats).toBe(6);
    expect(count.againstSeats).toBe(4);
    expect(hasTheVotes(count)).toBe(true);
  });

  it("counts player seats with their party", () => {
    const count = projectChamberVote(
      base({
        voters: [{ npp: npp("gov", 3), seats: 6 }],
        playerSeatsByParty: { gov: 1, opp: 10 },
      })
    );
    expect(count).toMatchObject({ forSeats: 7, againstSeats: 10 });
    expect(hasTheVotes(count)).toBe(false);
  });

  it("applies the opposition bloc to a government bill", () => {
    // A centrist opposition NPP leans against only because of the bloc force.
    const centrist = npp("opp", 0);
    const without = projectChamberVote(base({ voters: [{ npp: centrist, seats: 1 }] }));
    const withBloc = projectChamberVote(
      base({
        voters: [{ npp: centrist, seats: 1 }],
        opposition: { governingPartyId: "gov", oppositionPartyId: "opp" },
      })
    );
    expect(without.againstSeats).toBe(0);
    expect(withBloc.againstSeats).toBe(1);
  });
});

/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/turn/election/contingentHouseVoteStandings", () => ({
  loadHouseVoteStandings: vi.fn(async () => ({
    delegationVotes: { OH: "b", TX: null },
    delegationTotals: { a: 1, b: 1 },
    memberTotals: { a: 3, b: 5 },
    threshold: 26,
    delegationsVoting: 1,
    majorityWinnerId: null,
    leaderId: "b",
    explicitVoters: 1,
    delegations: [
      { stateId: "OH", backing: "b", tied: false, weights: { b: 5 } },
      { stateId: "TX", backing: null, tied: true, weights: { a: 3, b: 3 } },
    ],
    defiances: [],
    activeCandidateIds: ["a", "b"],
    droppedCandidateIds: [],
  })),
  loadPartyCoalitions: vi.fn(async () => ({})),
}));

import { buildContingentHouseVoteView } from "@/lib/elections/contingentHouseVoteView";
import { ContingentHouseVotePanel } from "./ContingentHouseVotePanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The panel renders what the server really builds, serialised the way the route sends it. */
describe("ContingentHouseVotePanel with the server payload", () => {
  it("renders the board built from a tally for a House member", async () => {
    const member = new ObjectId();
    const db = createMockDb();
    db.collection("electedOfficials").findOne.mockResolvedValue({ state: "OH" });
    db.collection("characters").findOne.mockResolvedValue({ party: "3" });
    db.collection("politicalParties").find.mockReturnValue({
      project: () => ({ toArray: async () => [{ sequentialId: 3, name: "Party Three" }] }),
    });
    db.collection("coalitions").find.mockReturnValue({
      project: () => ({ toArray: async () => [] }),
    });

    const view = await buildContingentHouseVoteView(
      db as unknown as Db,
      { _id: new ObjectId(), countryId: "US" },
      {
        candidateNames: { a: "Ada Alpha", b: "Ben Beta" },
        contingentResult: { houseVoteTotals: { a: 19, b: 22 }, houseThreshold: 26 },
        contingentHouseVote: {
          status: "open",
          openedTurn: 10,
          closesTurn: 34,
          actingPresidentId: "x",
          actingPresidentName: "Alex Acting",
          eligibleCandidateIds: ["a", "b"],
          votes: { [member.toString()]: "a" },
          whips: {
            "party:3": {
              candidateId: "b",
              setBy: "u",
              setByName: "Pat Chair",
              setAt: new Date(),
              turn: 12,
            },
          },
          ballots: [{ turn: 11, delegationVotes: {}, totals: { a: 1, b: 1 }, winnerId: null }],
        },
      } as never,
      12,
      member
    );
    const wire = JSON.parse(JSON.stringify({ vote: view }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => wire }))
    );

    render(<ContingentHouseVotePanel electionId="e1" />);
    expect(await screen.findByText(/Closes on turn 34 \(22 turns left\)/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Your vote" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Vote for Ben Beta" })).toBeTruthy();
    expect(screen.getByText(/Your party \(Party Three\)/)).toBeTruthy();
    expect(screen.getByText(/You are voting against it/)).toBeTruthy();
    expect(screen.getByLabelText("OH: Ben Beta")).toBeTruthy();
    expect(screen.getByLabelText("TX: tied, no vote")).toBeTruthy();
    expect(screen.getByText(/Turn 10 \(deadlock\)/)).toBeTruthy();
    expect(screen.getByText(/Turn 11/)).toBeTruthy();
  });
});

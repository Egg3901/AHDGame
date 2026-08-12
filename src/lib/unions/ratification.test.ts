import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { BargainingCampaign, BargainingRatification } from "@/lib/db/types";
import {
  buildRatificationView,
  isRatificationOpen,
  openRatificationVote,
  ratificationBlockReason,
  RATIFICATION_VOTE_TURNS,
  resolveRatification,
  tallyRatificationBallots,
} from "./ratification";

const alice = new ObjectId();
const bob = new ObjectId();
const carol = new ObjectId();

function ratification(overrides: Partial<BargainingRatification> = {}): BargainingRatification {
  const now = new Date();
  return {
    offerRevision: 2,
    status: "open",
    openedAtTurn: 100,
    closesAtTurn: 100 + RATIFICATION_VOTE_TURNS,
    weights: [
      { characterId: alice, strength: 60 },
      { characterId: bob, strength: 30 },
      { characterId: carol, strength: 10 },
    ],
    totalStrength: 100,
    openedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function ballot(voter: ObjectId, vote: "ratify" | "reject", offerRevision = 2) {
  return { voterCharacterId: voter, vote, offerRevision };
}

describe("ratification vote maths", () => {
  it("snapshots only organizers holding strength, and refuses an empty electorate", () => {
    const campaign = { currentOffer: { revision: 3 } } as BargainingCampaign;
    const opened = openRatificationVote({
      campaign,
      weights: new Map([
        [alice.toString(), 60],
        [bob.toString(), 0],
      ]),
      currentTurn: 100,
      now: new Date(),
    });
    expect(opened?.weights).toHaveLength(1);
    expect(opened?.totalStrength).toBe(60);
    expect(opened?.offerRevision).toBe(3);
    expect(opened?.closesAtTurn).toBe(100 + RATIFICATION_VOTE_TURNS);

    expect(
      openRatificationVote({ campaign, weights: new Map(), currentTurn: 100, now: new Date() })
    ).toBeNull();
  });

  it("weights ballots by snapshot strength and ignores strangers and stale revisions", () => {
    const tally = tallyRatificationBallots(ratification(), [
      ballot(alice, "ratify"),
      ballot(bob, "reject"),
      ballot(new ObjectId(), "reject"),
      ballot(carol, "ratify", 1),
    ]);
    expect(tally.ratifyStrength).toBe(60);
    expect(tally.rejectStrength).toBe(30);
    expect(tally.castStrength).toBe(90);
    expect(tally.outstandingStrength).toBe(10);
    expect(tally.ratifyCount).toBe(1);
  });

  it("counts one ballot per organizer even if the collection holds duplicates", () => {
    const tally = tallyRatificationBallots(ratification(), [
      ballot(alice, "ratify"),
      ballot(alice, "reject"),
    ]);
    expect(tally.ratifyStrength).toBe(60);
    expect(tally.rejectStrength).toBe(0);
  });
});

describe("ratification close condition", () => {
  const vote = ratification();

  it("closes early once a majority of all outstanding strength lands either way", () => {
    expect(
      resolveRatification(vote, tallyRatificationBallots(vote, [ballot(alice, "ratify")]), 100)
    ).toBe("ratified");
    expect(
      resolveRatification(vote, tallyRatificationBallots(vote, [ballot(alice, "reject")]), 100)
    ).toBe("rejected");
  });

  it("stays open while the result can still change", () => {
    expect(
      resolveRatification(vote, tallyRatificationBallots(vote, [ballot(bob, "reject")]), 101)
    ).toBeNull();
  });

  it("decides on the deadline turn, with a tie and with silence both ratifying", () => {
    const deadline = vote.closesAtTurn;
    expect(resolveRatification(vote, tallyRatificationBallots(vote, []), deadline)).toBe(
      "ratified"
    );
    expect(
      resolveRatification(
        vote,
        tallyRatificationBallots(
          ratification({
            weights: [
              { characterId: alice, strength: 50 },
              { characterId: bob, strength: 50 },
            ],
          }),
          [ballot(alice, "ratify"), ballot(bob, "reject")]
        ),
        deadline
      )
    ).toBe("ratified");
    expect(
      resolveRatification(vote, tallyRatificationBallots(vote, [ballot(bob, "reject")]), deadline)
    ).toBe("rejected");
  });

  it("never decides a vote that is not open", () => {
    const closed = ratification({ status: "rejected" });
    expect(resolveRatification(closed, tallyRatificationBallots(closed, []), 200)).toBeNull();
  });
});

describe("ratification gates and view", () => {
  const campaign = {
    status: "dispute",
    currentOffer: { revision: 2 },
    ratification: ratification(),
  } as BargainingCampaign;

  it("is open only while the campaign is open and the deadline has not passed", () => {
    expect(isRatificationOpen(campaign, 101)).toBe(true);
    expect(isRatificationOpen(campaign, campaign.ratification!.closesAtTurn)).toBe(false);
    expect(isRatificationOpen({ ...campaign, status: "withdrawn" }, 101)).toBe(false);
  });

  it("blocks re-tabling the same offer while it is out and after it was rejected", () => {
    expect(ratificationBlockReason(campaign, 101)).toContain("already voting");
    expect(
      ratificationBlockReason(
        { ...campaign, ratification: ratification({ status: "rejected" }) },
        200
      )
    ).toContain("counteroffer");
    // A new revision clears the block, which is the way out of a rejection.
    expect(
      ratificationBlockReason(
        {
          ...campaign,
          currentOffer: { ...campaign.currentOffer, revision: 3 },
          ratification: ratification({ status: "rejected" }),
        },
        200
      )
    ).toBeNull();
  });

  it("discloses the viewer's own weight and ballot and nobody else's", () => {
    const view = buildRatificationView(
      ratification(),
      [ballot(alice, "ratify"), ballot(bob, "reject")],
      bob
    );
    expect(view.viewerWeight).toBe(30);
    expect(view.viewerVote).toBe("reject");
    expect(view.voterCount).toBe(3);
    const stranger = buildRatificationView(ratification(), [ballot(alice, "ratify")], null);
    expect(stranger.viewerWeight).toBe(0);
    expect(stranger.viewerVote).toBeNull();
  });
});

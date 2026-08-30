import { describe, it, expect } from "vitest";
import { buildVoteShiftPreview } from "./voteShiftPreview";

const charKey = "64b000000000000000000001";

describe("buildVoteShiftPreview", () => {
  it("is null for a spectator who cannot vote", () => {
    expect(
      buildVoteShiftPreview({
        provisions: [{ economic: 3 }],
        ledger: undefined,
        characterId: charKey,
        policies: { economic: 0, social: 0 },
        previousVote: undefined,
        canVote: false,
      })
    ).toBeNull();
  });

  it("is null when there is no viewer character", () => {
    expect(
      buildVoteShiftPreview({
        provisions: [{ economic: 3 }],
        ledger: undefined,
        characterId: null,
        policies: undefined,
        previousVote: undefined,
        canVote: true,
      })
    ).toBeNull();
  });

  it("previews a first vote from the viewer's current position", () => {
    expect(
      buildVoteShiftPreview({
        provisions: [{ economic: -3, social: 2 }, { economic: 1 }],
        ledger: undefined,
        characterId: charKey,
        policies: { economic: 0, social: 0 },
        previousVote: undefined,
        canVote: true,
      })
    ).toEqual({
      current: { economic: 0, social: 0 },
      aye: { economic: -0.25, social: 0.25 },
      nay: { economic: 0.25, social: -0.25 },
    });
  });

  it("previews a re-vote from the ledger baseline so the net stays within one step", () => {
    expect(
      buildVoteShiftPreview({
        provisions: [{ economic: 3 }],
        ledger: {
          [charKey]: {
            baseline: { economic: 0, social: 0 },
            applied: { economic: 0.25, social: 0 },
          },
        },
        characterId: charKey,
        policies: { economic: 0.25, social: 0 },
        previousVote: "for",
        canVote: true,
      })
    ).toEqual({
      current: { economic: 0.25, social: 0 },
      aye: { economic: 0, social: 0 },
      nay: { economic: -0.5, social: 0 },
    });
  });

  it("previews no movement for a legacy vote that predates the ledger", () => {
    expect(
      buildVoteShiftPreview({
        provisions: [{ economic: 3 }],
        ledger: undefined,
        characterId: charKey,
        policies: { economic: 0, social: 0 },
        previousVote: "against",
        canVote: true,
      })
    ).toEqual({
      current: { economic: 0, social: 0 },
      aye: { economic: 0, social: 0 },
      nay: { economic: 0, social: 0 },
    });
  });

  it("previews no movement when the bill takes no stance", () => {
    expect(
      buildVoteShiftPreview({
        provisions: [{ economic: 0 }, {}],
        ledger: undefined,
        characterId: charKey,
        policies: { economic: 1, social: 1 },
        previousVote: undefined,
        canVote: true,
      })
    ).toEqual({
      current: { economic: 1, social: 1 },
      aye: { economic: 0, social: 0 },
      nay: { economic: 0, social: 0 },
    });
  });
});

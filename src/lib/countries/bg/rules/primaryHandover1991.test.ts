import { describe, expect, it } from "vitest";
import { BG_ORDINARY_ASSEMBLY_SEATS } from "./assemblyTransition";
import { canRebindBg1991PrimaryCohort } from "./primaryHandover1991";

function fixture() {
  const polls = Object.keys(BG_ORDINARY_ASSEMBLY_SEATS).map((state) => ({
    id: state,
    state,
    cycle: 2,
    primaryEndTurn: 30,
    foundingRound: 1 as const,
    receiptId: "BG:founding1990:2",
    ruleVersion: "parallel-1990-v1",
  }));
  return {
    polls,
    tallies: polls.map((row) => ({ electionId: row.id, finalized: false, votes: [0] })),
    hasCertifiedReceipt: false,
    turn: 26,
    nowMs: 1000,
  };
}
describe("Bulgarian constitutional first-round handover", () => {
  it("admits a complete untouched bound first round", () => {
    expect(canRebindBg1991PrimaryCohort(fixture())).toBe(true);
  });
  it("keeps renewed polls, journaled counts, closed filing and cast ballots frozen", () => {
    const input = fixture();
    expect(
      canRebindBg1991PrimaryCohort({
        ...input,
        polls: input.polls.map((row) => ({ ...row, foundingRound: 2 })),
      })
    ).toBe(false);
    expect(canRebindBg1991PrimaryCohort({ ...input, hasCertifiedReceipt: true })).toBe(false);
    expect(canRebindBg1991PrimaryCohort({ ...input, turn: 30 })).toBe(false);
    expect(
      canRebindBg1991PrimaryCohort({
        ...input,
        tallies: input.tallies.map((row, i) => ({ ...row, votes: [i === 0 ? 1 : 0] })),
      })
    ).toBe(false);
  });
  it("refuses incomplete, mixed or duplicate cohort bindings", () => {
    const input = fixture();
    expect(canRebindBg1991PrimaryCohort({ ...input, polls: input.polls.slice(1) })).toBe(false);
    expect(
      canRebindBg1991PrimaryCohort({
        ...input,
        polls: input.polls.map((row, i) => ({
          ...row,
          receiptId: i === 0 ? "other-receipt" : row.receiptId,
        })),
      })
    ).toBe(false);
    expect(
      canRebindBg1991PrimaryCohort({
        ...input,
        polls: [input.polls[0], ...input.polls.slice(0, -1)],
      })
    ).toBe(false);
    expect(
      canRebindBg1991PrimaryCohort({ ...input, tallies: [...input.tallies, input.tallies[0]] })
    ).toBe(false);
  });
});

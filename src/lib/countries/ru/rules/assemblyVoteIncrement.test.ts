import { describe, expect, it } from "vitest";
import { russianDumaVoteTotals as totals } from "./assemblyVoteIncrement";

describe("Duma frozen vote accumulation", () => {
  it("retains counted withdrawals in the register ceiling and apportions the last votes", () => {
    expect(
      totals({
        registeredVoters: 100,
        priorVotes: { withdrawn: 60, a: 20, b: 10 },
        rawVotes: { a: 20, b: 20 },
      })
    ).toEqual({ withdrawn: 60, a: 25, b: 15 });
  });
  it("keeps raw party shares below the ceiling and allows a zero-electorate district", () => {
    expect(totals({ registeredVoters: 100, priorVotes: {}, rawVotes: { a: 21, b: 7 } })).toEqual({
      a: 21,
      b: 7,
    });
    expect(totals({ registeredVoters: 0, priorVotes: {}, rawVotes: { a: 4 } })).toEqual({ a: 0 });
  });
  it("uses stable remainder ties and cannot erase prior votes on an exhausted ballot", () => {
    expect(totals({ registeredVoters: 1, priorVotes: {}, rawVotes: { b: 5, a: 5 } })).toEqual({
      a: 1,
      b: 0,
    });
    expect(
      totals({ registeredVoters: 1, priorVotes: { withdrawn: 1 }, rawVotes: { a: 5 } })
    ).toEqual({ withdrawn: 1, a: 0 });
  });
  it("reserves counted against-all ballots within the same participation ceiling", () => {
    expect(
      totals({
        registeredVoters: 100,
        againstAllVotes: 20,
        priorVotes: { withdrawn: 60 },
        rawVotes: { a: 50 },
      })
    ).toEqual({ withdrawn: 60, a: 20 });
    expect(() =>
      totals({ registeredVoters: 100, againstAllVotes: 101, priorVotes: {}, rawVotes: {} })
    ).toThrow("against-all");
    expect(() =>
      totals({ registeredVoters: 100, againstAllVotes: 20, priorVotes: { a: 81 }, rawVotes: {} })
    ).toThrow("prior participation");
  });
  it("rejects corrupt prior counts instead of recertifying a smaller participation total", () => {
    for (const priorVotes of [{ withdrawn: 101 }, { withdrawn: -1 }, { withdrawn: 0.5 }])
      expect(() => totals({ registeredVoters: 100, priorVotes, rawVotes: { a: 1 } })).toThrow();
  });
});

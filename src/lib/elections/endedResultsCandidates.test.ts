import { describe, it, expect } from "vitest";
import { selectEndedDisplayCandidates } from "./endedResultsCandidates";

const cands = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("selectEndedDisplayCandidates", () => {
  it("keeps the real contestants (those with tally votes) even when all are withdrawn", () => {
    // At resolution every candidate is withdrawn as cleanup; the tally still
    // holds their final votes. All three contested → all kept.
    const withdrawn = new Set(["a", "b", "c"]);
    const totalVotes = { a: 236502, b: 16722, c: 279890 };
    const result = selectEndedDisplayCandidates(cands, withdrawn, totalVotes);
    expect(result.map((c) => c.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("drops candidates with no tally votes (pre-general drop-outs / primary losers)", () => {
    const withdrawn = new Set(["a", "b", "c"]);
    const totalVotes = { a: 5000, c: 9000 }; // b never reached the general
    const result = selectEndedDisplayCandidates(cands, withdrawn, totalVotes);
    expect(result.map((c) => c.id).sort()).toEqual(["a", "c"]);
  });

  it("falls back to non-withdrawn candidates when the tally has no votes", () => {
    const withdrawn = new Set(["b"]);
    const result = selectEndedDisplayCandidates(cands, withdrawn, {});
    expect(result.map((c) => c.id).sort()).toEqual(["a", "c"]);
  });

  it("falls back to non-withdrawn when the tally is missing", () => {
    const withdrawn = new Set(["a"]);
    const result = selectEndedDisplayCandidates(cands, withdrawn, undefined);
    expect(result.map((c) => c.id).sort()).toEqual(["b", "c"]);
  });
});

import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { ElectionVoteTally } from "@/lib/db/types";
import { incumbentShareFromFinalizedTally } from "./incumbentSeatShare";

describe("incumbency after ranked transfers", () => {
  const tally: ElectionVoteTally = {
    _id: new ObjectId(),
    electionId: new ObjectId(),
    state: "DUB",
    countingMethod: "pr_stv",
    resolutionPath: "pr_stv",
    finalized: true,
    totalVotes: { a: 30, b: 25, c: 18, d: 14, e: 8, f: 5 },
    candidateNames: {},
    candidateParties: { a: "1", b: "2", c: "2", d: "1", e: "2", f: "1" },
    seatsEstimate: { a: 1, b: 1, c: 0, d: 1, e: 0, f: 0 },
    turnSnapshots: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  it("uses the two seats won rather than a minority of first preferences", () => {
    expect(incumbentShareFromFinalizedTally(tally).get("1")).toBeCloseTo(2 / 3);
    expect(incumbentShareFromFinalizedTally(tally).get("2")).toBeCloseTo(1 / 3);
  });
  it("keeps the legacy first-preference proxy for existing Hare tallies", () => {
    expect(
      incumbentShareFromFinalizedTally({ ...tally, countingMethod: undefined }).get("1")
    ).toBeCloseTo(0.49);
  });
  it("does not infer an STV incumbency result from incomplete historical evidence", () => {
    expect(incumbentShareFromFinalizedTally({ ...tally, resolutionPath: undefined }).size).toBe(0);
    expect(incumbentShareFromFinalizedTally({ ...tally, seatsEstimate: undefined }).size).toBe(0);
  });
});

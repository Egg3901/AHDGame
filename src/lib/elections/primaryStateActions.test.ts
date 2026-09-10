import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { liveActionFilter } from "./primaryStateActions";

const ELECTION = new ObjectId();

describe("liveActionFilter", () => {
  it("asks only for rows that have not expired", () => {
    const filter = liveActionFilter(ELECTION, 12);
    expect(filter.electionId).toBe(ELECTION);
    expect(filter.expiresTurn).toEqual({ $gt: 12 });
  });
});

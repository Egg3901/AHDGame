import { describe, expect, it } from "vitest";
import { allocateHuListTurnVotes } from "./listBallots2014";

describe("Hungarian national second vote", () => {
  it("allocates one list ballot per voter from party support rather than district candidate votes", () => {
    const votes = allocateHuListTurnVotes(1_000, [
      { partyId: "a", registration: 60 },
      { partyId: "b", registration: 40 },
    ]);
    expect(votes).toEqual({ a: 600, b: 400 });
  });
});

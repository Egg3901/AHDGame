import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import {
  directableFundsFor,
  fundStakesIn,
  resolveFundStewardship,
  stewardshipBallot,
  STEWARDSHIP_DIRECTION_THRESHOLD,
} from "./fundStewardship";

const fundId = new ObjectId();
const holderId = new ObjectId();

function corpWithFundStake(fundShares: number, otherShares = 600): Corporation {
  return {
    _id: new ObjectId(),
    totalShares: fundShares + otherShares,
    shareholders: [
      { fundId, shares: fundShares },
      { characterId: new ObjectId(), shares: otherShares },
    ],
  } as unknown as Corporation;
}

describe("fund stakes", () => {
  it("finds fund-held stakes and their voting power", () => {
    const stakes = fundStakesIn(corpWithFundStake(400));
    expect(stakes).toHaveLength(1);
    expect(stakes[0].votingPower).toBe(400);
  });

  it("ignores a zero-share fund entry", () => {
    expect(fundStakesIn(corpWithFundStake(0))).toHaveLength(0);
  });
});

describe("stewardship ballot", () => {
  it("follows a unit holder who controls the fund", () => {
    const ballot = stewardshipBallot({
      votingPower: 400,
      castYes: 10,
      castNo: 500,
      direction: { holderId, unitShare: 0.8, vote: "yes" },
    });
    expect(ballot).toMatchObject({ kind: "directed", vote: "yes", votingPower: 400 });
  });

  it("ignores an instruction from a holder below the control threshold", () => {
    const ballot = stewardshipBallot({
      votingPower: 400,
      castYes: 500,
      castNo: 10,
      direction: {
        holderId,
        unitShare: STEWARDSHIP_DIRECTION_THRESHOLD - 0.01,
        vote: "no",
      },
    });
    // Falls through to mirroring, which follows the actual majority.
    expect(ballot).toMatchObject({ kind: "mirror", vote: "yes" });
  });

  it("mirrors the majority actually cast when undirected", () => {
    expect(stewardshipBallot({ votingPower: 400, castYes: 100, castNo: 30 })).toMatchObject({
      kind: "mirror",
      vote: "yes",
    });
    expect(stewardshipBallot({ votingPower: 400, castYes: 30, castNo: 100 })).toMatchObject({
      kind: "mirror",
      vote: "no",
    });
  });

  it("abstains on a tie rather than breaking it", () => {
    // Mirroring a tie would make a passive vehicle the kingmaker.
    const ballot = stewardshipBallot({ votingPower: 400, castYes: 100, castNo: 100 });
    expect(ballot).toMatchObject({ kind: "abstain", votingPower: 0 });
  });

  it("abstains when nobody else voted, and leaves the denominator", () => {
    const ballot = stewardshipBallot({ votingPower: 400, castYes: 0, castNo: 0 });
    expect(ballot).toEqual({ kind: "abstain", votingPower: 0, excludedFromDenominator: 400 });
  });
});

describe("resolveFundStewardship", () => {
  const db = {
    collection: vi.fn(() => ({ find: vi.fn(() => ({ toArray: async () => [] })) })),
  } as unknown as Db;

  it("adds the fund's weight to the winning side", async () => {
    const result = await resolveFundStewardship(db, {
      corporation: corpWithFundStake(400),
      castYes: 500,
      castNo: 100,
    });
    expect(result).toEqual({ yes: 400, no: 0, excludedFromDenominator: 0 });
  });

  it("pulls an abstaining fund out of the denominator so a vote can still pass", async () => {
    // This is the deadlock fix: 400 uncastable shares used to sit in the
    // denominator forever, so a corporation with a large index holder could
    // never clear a threshold.
    const result = await resolveFundStewardship(db, {
      corporation: corpWithFundStake(400),
      castYes: 0,
      castNo: 0,
    });
    expect(result).toEqual({ yes: 0, no: 0, excludedFromDenominator: 400 });
  });

  it("is a no-op for a corporation no fund holds", async () => {
    const corp = {
      _id: new ObjectId(),
      totalShares: 100,
      shareholders: [{ characterId: new ObjectId(), shares: 100 }],
    } as unknown as Corporation;
    expect(await resolveFundStewardship(db, { corporation: corp, castYes: 5, castNo: 1 })).toEqual({
      yes: 0,
      no: 0,
      excludedFromDenominator: 0,
    });
  });
});

/**
 * The directed half was unreachable until the instruction surface shipped: the
 * sole caller passed no `directions`, so every fund fell through to
 * mirror-or-abstain. These cover the path end to end from a stored instruction.
 */
describe("resolveFundStewardship with an instruction", () => {
  function dbWithPositions(
    positions: { holderKind: string; characterId?: ObjectId; units: number }[]
  ) {
    return {
      collection: vi.fn(() => ({
        find: vi.fn(() => ({ toArray: async () => positions })),
      })),
    } as unknown as Db;
  }

  it("votes the fund AGAINST the majority when its controller says so", async () => {
    const db = dbWithPositions([
      { holderKind: "character", characterId: holderId, units: 800 },
      { holderKind: "character", characterId: new ObjectId(), units: 200 },
    ]);
    const result = await resolveFundStewardship(db, {
      corporation: corpWithFundStake(400),
      castYes: 500,
      castNo: 100,
      directions: new Map([
        [fundId.toString(), { vote: "no" as const, directorCharacterId: holderId }],
      ]),
    });
    // Mirroring would have added 400 to YES. Control means control.
    expect(result).toEqual({ yes: 0, no: 400, excludedFromDenominator: 0 });
  });

  it("ignores an instruction once the instructing holder is no longer in control", async () => {
    const db = dbWithPositions([
      { holderKind: "character", characterId: holderId, units: 300 },
      { holderKind: "character", characterId: new ObjectId(), units: 700 },
    ]);
    const result = await resolveFundStewardship(db, {
      corporation: corpWithFundStake(400),
      castYes: 500,
      castNo: 100,
      directions: new Map([
        [fundId.toString(), { vote: "no" as const, directorCharacterId: holderId }],
      ]),
    });
    // Falls back to mirroring rather than honouring a stale instruction.
    expect(result).toEqual({ yes: 400, no: 0, excludedFromDenominator: 0 });
  });

  it("lets a directed fund carry a vote nobody else voted on", async () => {
    const db = dbWithPositions([{ holderKind: "character", characterId: holderId, units: 1000 }]);
    const result = await resolveFundStewardship(db, {
      corporation: corpWithFundStake(400),
      castYes: 0,
      castNo: 0,
      directions: new Map([
        [fundId.toString(), { vote: "yes" as const, directorCharacterId: holderId }],
      ]),
    });
    // Without an instruction this is the abstain case. With one it is a vote,
    // and the shares stay in the denominator because they were cast.
    expect(result).toEqual({ yes: 400, no: 0, excludedFromDenominator: 0 });
  });

  it("never treats the fund's own reserve float as a director", async () => {
    const db = dbWithPositions([
      { holderKind: "fund_reserve", units: 900 },
      { holderKind: "character", characterId: holderId, units: 100 },
    ]);
    const result = await resolveFundStewardship(db, {
      corporation: corpWithFundStake(400),
      castYes: 500,
      castNo: 100,
      directions: new Map([
        [fundId.toString(), { vote: "no" as const, directorCharacterId: holderId }],
      ]),
    });
    // 100 of 1000 units is not control, so the instruction does not bind.
    expect(result).toEqual({ yes: 400, no: 0, excludedFromDenominator: 0 });
  });
});

describe("directableFundsFor", () => {
  function db(positions: { holderKind: string; characterId?: ObjectId; units: number }[]) {
    return {
      collection: vi.fn((name: string) => ({
        find: vi.fn(() => ({
          toArray: async () =>
            name === "indexFunds"
              ? [{ _id: fundId, name: "Global Top 50", tickerSymbol: "GT50" }]
              : positions,
        })),
      })),
    } as unknown as Db;
  }

  it("lists a fund the caller controls, with what it carries into the vote", async () => {
    const funds = await directableFundsFor(
      db([{ holderKind: "character", characterId: holderId, units: 1000 }]),
      corpWithFundStake(400),
      holderId
    );
    expect(funds).toEqual([
      {
        fundId,
        name: "Global Top 50",
        tickerSymbol: "GT50",
        unitShare: 1,
        votingPower: 400,
      },
    ]);
  });

  it("lists nothing for a holder who is not the controller", async () => {
    const funds = await directableFundsFor(
      db([
        { holderKind: "character", characterId: new ObjectId(), units: 900 },
        { holderKind: "character", characterId: holderId, units: 100 },
      ]),
      corpWithFundStake(400),
      holderId
    );
    expect(funds).toEqual([]);
  });

  it("lists nothing when no fund holds the corporation", async () => {
    const corp = {
      _id: new ObjectId(),
      totalShares: 100,
      shareholders: [{ characterId: new ObjectId(), shares: 100 }],
    } as unknown as Corporation;
    const funds = await directableFundsFor(
      db([{ holderKind: "character", characterId: holderId, units: 1000 }]),
      corp,
      holderId
    );
    expect(funds).toEqual([]);
  });
});

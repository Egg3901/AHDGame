import { describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  checkPlayerPayoutCap,
  countDistinctOfficers,
  getEffectivePlayerPayoutCap,
  getPlayerPayoutThisTurn,
  getPlayerPayoutCap,
  DEFAULT_PLAYER_PAYOUT_CAP_PER_TURN,
  PAYOUT_CAP_MULTI_OFFICER_MULTIPLIER,
} from "./payoutCap";

function makeDb(alreadyPaid: number | null) {
  const aggregate = vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue(alreadyPaid === null ? [] : [{ total: alreadyPaid }]),
  });
  const db = {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name !== "treasuryTransactions") throw new Error(`unexpected collection ${name}`);
      return { aggregate };
    }),
  } as unknown as Db;
  return { db, aggregate };
}

describe("getPlayerPayoutCap", () => {
  it("uses the tuned value for a country in the table", () => {
    expect(getPlayerPayoutCap("US")).toBe(2_000_000);
    expect(getPlayerPayoutCap("UK")).toBe(2_000_000);
    expect(getPlayerPayoutCap("RU")).toBe(1_500_000);
    expect(getPlayerPayoutCap("DD")).toBe(1_500_000);
    expect(getPlayerPayoutCap("JP")).toBe(10_000_000);
  });

  it("falls back to the default for an untuned country", () => {
    expect(getPlayerPayoutCap("NG")).toBe(DEFAULT_PLAYER_PAYOUT_CAP_PER_TURN);
  });

  it("normalises the country id, so a lowercase caller still gets the right cap", () => {
    // A miss falls back silently, so "ru" would otherwise show and enforce
    // 2,000,000 instead of 1,500,000 with no error anywhere.
    expect(getPlayerPayoutCap("ru")).toBe(1_500_000);
    expect(getPlayerPayoutCap("jp")).toBe(10_000_000);
  });
});

describe("countDistinctOfficers", () => {
  it("counts people, not seats", () => {
    // One person holding two seats is one officer. Counting seats would
    // hand a lone chair-and-treasurer the two-officer allowance.
    expect(countDistinctOfficers(["a", "a", "b"])).toBe(2);
    expect(countDistinctOfficers(["a", "a", null])).toBe(1);
  });

  it("ignores empty seats in any shape", () => {
    expect(countDistinctOfficers([null, undefined, ""])).toBe(0);
    expect(countDistinctOfficers([])).toBe(0);
  });
});

describe("getEffectivePlayerPayoutCap", () => {
  it("leaves the base cap alone below two officers", () => {
    expect(getEffectivePlayerPayoutCap("US", 0)).toBe(2_000_000);
    expect(getEffectivePlayerPayoutCap("US", 1)).toBe(2_000_000);
  });

  it("multiplies once two officers are seated", () => {
    expect(getEffectivePlayerPayoutCap("US", 2)).toBe(
      2_000_000 * PAYOUT_CAP_MULTI_OFFICER_MULTIPLIER
    );
  });

  it("does not scale further with a third officer", () => {
    expect(getEffectivePlayerPayoutCap("US", 3)).toBe(getEffectivePlayerPayoutCap("US", 2));
  });

  it("raises every country off its own base, not just the US", () => {
    // The multiplier rides on whatever the country is tuned to, so a
    // cheaper economy keeps its proportion rather than being levelled up
    // to a dollar figure borrowed from somewhere else.
    for (const country of ["US", "UK", "RU", "DD", "JP", "FR"]) {
      const base = getPlayerPayoutCap(country);
      expect(getEffectivePlayerPayoutCap(country, 1)).toBe(base);
      expect(getEffectivePlayerPayoutCap(country, 2)).toBe(
        base * PAYOUT_CAP_MULTI_OFFICER_MULTIPLIER
      );
    }
  });

  it("falls back to the default base for an unknown country", () => {
    expect(getEffectivePlayerPayoutCap("ZZ", 2)).toBe(
      DEFAULT_PLAYER_PAYOUT_CAP_PER_TURN * PAYOUT_CAP_MULTI_OFFICER_MULTIPLIER
    );
  });
});

describe("getPlayerPayoutThisTurn", () => {
  it("returns 0 when the player has received nothing this turn", async () => {
    const { db } = makeDb(null);
    expect(await getPlayerPayoutThisTurn(db, new ObjectId(), "UK", 100)).toBe(0);
  });

  it("sums every party-money source for that character and turn", async () => {
    const characterId = new ObjectId();
    const { db, aggregate } = makeDb(750_000);
    expect(await getPlayerPayoutThisTurn(db, characterId, "UK", 100)).toBe(750_000);

    const [pipeline] = aggregate.mock.calls[0] as [Array<Record<string, unknown>>];
    // Deliberately NOT filtered by holderType: national party, state
    // party and caucus payouts all count towards the one ceiling.
    expect(pipeline[0]).toEqual({
      $match: {
        countryId: "UK",
        turn: 100,
        category: "transfers",
        direction: "debit",
        "counterparty.type": "character",
        "counterparty.id": characterId.toString(),
      },
    });
  });
});

describe("checkPlayerPayoutCap", () => {
  const base = { characterId: new ObjectId(), countryId: "UK" as const, currentTurn: 100 };

  it("allows a payment inside the remaining allowance", async () => {
    const { db } = makeDb(500_000);
    const result = await checkPlayerPayoutCap(db, { ...base, amount: 1_400_000 });
    expect(result.ok).toBe(true);
    expect(result.remaining).toBe(1_500_000);
  });

  it("allows a payment that lands exactly on the cap", async () => {
    const { db } = makeDb(500_000);
    const result = await checkPlayerPayoutCap(db, { ...base, amount: 1_500_000 });
    expect(result.ok).toBe(true);
  });

  it("refuses a payment one unit over the remaining allowance", async () => {
    const { db } = makeDb(500_000);
    const result = await checkPlayerPayoutCap(db, { ...base, amount: 1_500_001 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toMatch(/1,500,000 more/);
  });

  it("refuses everything once the cap is used up", async () => {
    const { db } = makeDb(2_000_000);
    const result = await checkPlayerPayoutCap(db, { ...base, amount: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.remaining).toBe(0);
    expect(result.reason).toMatch(/already received £2,000,000/);
  });

  it("names what the member actually drew, not this treasury's ceiling", async () => {
    // A member paid up to a well staffed party's raised ceiling then
    // runs into a lone officer's lower one. Reporting "the maximum of
    // $2,000,000" would name a figure they never hit.
    const { db } = makeDb(10_000_000);
    const result = await checkPlayerPayoutCap(db, { ...base, amount: 1, seatedOfficers: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toContain("already received £10,000,000");
    expect(result.reason).toContain("£2,000,000 this treasury may pay");
  });

  it("never reports a negative allowance when past payouts exceed the cap", async () => {
    // Historic rows predate the cap, so `used` can legitimately be larger.
    const { db } = makeDb(30_000_000);
    const result = await checkPlayerPayoutCap(db, { ...base, amount: 1 });
    expect(result.remaining).toBe(0);
  });

  it("applies the country's own cap, not a global one", async () => {
    const { db } = makeDb(0);
    const ru = await checkPlayerPayoutCap(db, { ...base, countryId: "RU", amount: 1_600_000 });
    expect(ru.ok).toBe(false);
    const { db: db2 } = makeDb(0);
    const jp = await checkPlayerPayoutCap(db2, { ...base, countryId: "JP", amount: 1_600_000 });
    expect(jp.ok).toBe(true);
  });
});

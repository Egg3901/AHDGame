import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { computeGroupRelief, poolByGroupAndCountry } from "./lossRelief";

const A = new ObjectId();
const B = new ObjectId();
const C = new ObjectId();

const member = (
  corporationId: ObjectId,
  incomePreTaxAnchor: number,
  taxPaidAnchor: number,
  countryId = "US"
) => ({ corporationId, countryId, incomePreTaxAnchor, taxPaidAnchor });

describe("computeGroupRelief", () => {
  it("surrenders a subsidiary's loss against the parent's profit", () => {
    // Parent earns 1,000 and pays 400 (a 40% effective rate). Subsidiary loses
    // 250. The group should be taxed on 750, so 250 × 40% = 100 comes back.
    const outcome = computeGroupRelief([member(A, 1_000, 400), member(B, -250, 0)]);
    expect(outcome.lossesSurrenderedAnchor).toBe(250);
    expect(outcome.totalReliefAnchor).toBe(100);
    expect(outcome.allocations).toHaveLength(1);
    expect(outcome.allocations[0].corporationId).toBe(A);
  });

  it("cannot surrender more loss than there is profit to shelter", () => {
    // A 5,000 loss against a 1,000 profit relieves 1,000, not 5,000. The
    // remainder is a carry-forward, which is a different mechanic.
    const outcome = computeGroupRelief([member(A, 1_000, 400), member(B, -5_000, 0)]);
    expect(outcome.lossesSurrenderedAnchor).toBe(1_000);
    expect(outcome.totalReliefAnchor).toBe(400);
  });

  it("never refunds more than the group actually paid", () => {
    // Contrived: a large loss and a profit taxed at a punitive implied rate.
    // Relief is still capped at the tax collected, so the treasury can never be
    // made to pay out to a group on net.
    const outcome = computeGroupRelief([member(A, 100, 100), member(B, -100, 0)]);
    expect(outcome.totalReliefAnchor).toBeLessThanOrEqual(100);
  });

  it("does nothing for a group with no losses", () => {
    expect(computeGroupRelief([member(A, 1_000, 400), member(B, 500, 200)])).toEqual({
      allocations: [],
      totalReliefAnchor: 0,
      lossesSurrenderedAnchor: 0,
    });
  });

  it("does nothing for a group with no profits", () => {
    expect(computeGroupRelief([member(A, -1_000, 0), member(B, -500, 0)]).totalReliefAnchor).toBe(
      0
    );
  });

  it("does nothing for a group that paid no tax", () => {
    // A pass-through structure pays no corporate tax, so there is nothing to
    // refund even though the arithmetic profit exists.
    expect(computeGroupRelief([member(A, 1_000, 0), member(B, -250, 0)]).totalReliefAnchor).toBe(0);
  });

  it("is a no-op for a lone corporation", () => {
    expect(computeGroupRelief([member(A, -1_000, 0)]).totalReliefAnchor).toBe(0);
  });

  it("splits relief across payers in proportion to what each paid", () => {
    const outcome = computeGroupRelief([
      member(A, 1_000, 300),
      member(B, 1_000, 100),
      member(C, -400, 0),
    ]);
    // Effective rate 400/2000 = 20%; 400 of loss relieves 80.
    expect(outcome.totalReliefAnchor).toBe(80);
    const byCorp = new Map(outcome.allocations.map((a) => [a.corporationId, a.reliefAnchor]));
    expect(byCorp.get(A)).toBe(60);
    expect(byCorp.get(B)).toBe(20);
  });

  it("allocates to the last ₳, creating and losing nothing in the split", () => {
    // Deliberately awkward numbers so the pro-rata shares do not divide evenly.
    const outcome = computeGroupRelief([
      member(A, 999, 333),
      member(B, 777, 111),
      member(C, -333, 0),
    ]);
    const summed = outcome.allocations.reduce((s, a) => s + a.reliefAnchor, 0);
    expect(summed).toBe(outcome.totalReliefAnchor);
  });

  it("ignores malformed income rather than propagating NaN into the treasury", () => {
    const outcome = computeGroupRelief([
      member(A, 1_000, 400),
      member(B, Number.NaN, 0),
      member(C, -250, 0),
    ]);
    expect(Number.isFinite(outcome.totalReliefAnchor)).toBe(true);
    expect(outcome.totalReliefAnchor).toBe(100);
  });
});

describe("poolByGroupAndCountry", () => {
  it("keeps a group's countries apart, so a loss cannot cross a tax border", () => {
    const pools = poolByGroupAndCountry([
      { ...member(A, 1_000, 400, "US"), groupRootId: "root" },
      { ...member(B, -250, 0, "UK"), groupRootId: "root" },
    ]);
    expect(pools.size).toBe(2);
    // Neither pool has both a profit and a loss, so neither relieves anything.
    for (const pool of pools.values()) {
      expect(computeGroupRelief(pool).totalReliefAnchor).toBe(0);
    }
  });

  it("keeps separate groups apart in the same country", () => {
    const pools = poolByGroupAndCountry([
      { ...member(A, 1_000, 400, "US"), groupRootId: "group-1" },
      { ...member(B, -250, 0, "US"), groupRootId: "group-2" },
    ]);
    expect(pools.size).toBe(2);
  });

  it("pools members of one group in one country", () => {
    const pools = poolByGroupAndCountry([
      { ...member(A, 1_000, 400, "US"), groupRootId: "root" },
      { ...member(B, -250, 0, "US"), groupRootId: "root" },
    ]);
    expect(pools.size).toBe(1);
    expect(computeGroupRelief([...pools.values()][0]).totalReliefAnchor).toBe(100);
  });
});

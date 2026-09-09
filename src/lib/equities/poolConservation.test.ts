import { describe, expect, it } from "vitest";
import { poolConservationResidual } from "./poolConservation";
import type { EquityMarketPool } from "@/lib/db/types";

const pool = (over: Partial<EquityMarketPool> = {}): EquityMarketPool =>
  ({
    _id: "USD",
    cashLocal: 1_000,
    targetCashLocal: 2_000,
    seedLocal: 1_000,
    lifetime: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as EquityMarketPool;

describe("poolConservationResidual", () => {
  it("is zero for a pool that has only been seeded", () => {
    expect(poolConservationResidual(pool())).toBeCloseTo(0, 2);
  });

  it("is zero when purchases and sales net out", () => {
    expect(
      poolConservationResidual(
        pool({ cashLocal: 1_200, lifetime: { purchasesIn: 500, salesOut: 300 } })
      )
    ).toBeCloseTo(0, 2);
  });

  it("is positive when the pool minted cash", () => {
    // inflowIn is not a term, so the money it added shows up as a residual.
    expect(
      poolConservationResidual(pool({ cashLocal: 1_500, lifetime: { inflowIn: 500 } }))
    ).toBeCloseTo(500, 2);
  });

  it("counts issuance and sweeps as outflows", () => {
    expect(
      poolConservationResidual(
        pool({ cashLocal: 400, lifetime: { issuanceOut: 400, sweepOut: 200 } })
      )
    ).toBeCloseTo(0, 2);
  });

  it("counts dividends as a real inflow", () => {
    expect(
      poolConservationResidual(pool({ cashLocal: 1_250, lifetime: { dividendsIn: 250 } }))
    ).toBeCloseTo(0, 2);
  });

  it("is NaN for a pool with no recorded seed, rather than a wrong number", () => {
    const p = pool();
    delete (p as { seedLocal?: number }).seedLocal;
    expect(Number.isNaN(poolConservationResidual(p))).toBe(true);
  });

  it("treats missing lifetime counters as zero", () => {
    const p = pool();
    delete (p as { lifetime?: unknown }).lifetime;
    expect(poolConservationResidual(p)).toBeCloseTo(0, 2);
  });

  it("reproduces the live USD residual once the seed is backfilled", () => {
    // Turn 695 figures.
    //
    // `inferSeedLocal` reconstructs history as it happened, so it COUNTS
    // inflowIn and lands on 41,469,472,832. Feeding that seed back through the
    // identity, which does NOT count inflowIn, leaves a residual of exactly the
    // amount minted. That asymmetry is the point: the backfill is honest about
    // the past and the identity is honest about what was owed.
    const residual = poolConservationResidual(
      pool({
        cashLocal: 39_225_203_119,
        seedLocal: 41_469_472_832,
        lifetime: {
          purchasesIn: 3_765_566_082,
          dividendsIn: 133_388_326,
          salesOut: 21_041_533_202,
          issuanceOut: 7_087_440_023,
          inflowIn: 21_985_749_104,
        },
      })
    );
    expect(residual).toBeCloseTo(21_985_749_104, 0);
  });
});

import { describe, expect, it } from "vitest";
import { inferSeedLocal } from "./2026-09-07-equity-pool-seed-backfill";
import { poolConservationResidual } from "@/lib/equities/poolConservation";
import type { EquityMarketPool } from "@/lib/db/types";

const pool = (over: Partial<EquityMarketPool>): EquityMarketPool =>
  ({
    _id: "USD",
    cashLocal: 0,
    targetCashLocal: 0,
    lifetime: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as EquityMarketPool;

describe("inferSeedLocal", () => {
  it("reconstructs the USD seed observed live at turn 695", () => {
    const seed = inferSeedLocal(
      pool({
        cashLocal: 39_225_203_119,
        lifetime: {
          purchasesIn: 3_765_566_082,
          dividendsIn: 133_388_326,
          inflowIn: 21_985_749_104,
          salesOut: 21_041_533_202,
          issuanceOut: 7_087_440_023,
        },
      })
    );
    expect(seed).toBeCloseTo(41_469_472_832, 0);
  });

  it("leaves a backfilled pool reading a residual of exactly what it minted", () => {
    const p = pool({
      cashLocal: 39_225_203_119,
      lifetime: {
        purchasesIn: 3_765_566_082,
        dividendsIn: 133_388_326,
        inflowIn: 21_985_749_104,
        salesOut: 21_041_533_202,
        issuanceOut: 7_087_440_023,
      },
    });
    const residual = poolConservationResidual({ ...p, seedLocal: inferSeedLocal(p) });
    expect(residual).toBeCloseTo(21_985_749_104, 0);
  });

  it("gives a never-minting pool a residual of zero", () => {
    const p = pool({ cashLocal: 1_200, lifetime: { purchasesIn: 500, salesOut: 300 } });
    const residual = poolConservationResidual({ ...p, seedLocal: inferSeedLocal(p) });
    expect(inferSeedLocal(p)).toBeCloseTo(1_000, 2);
    expect(residual).toBeCloseTo(0, 2);
  });

  it("returns 0 rather than a negative seed", () => {
    expect(inferSeedLocal(pool({ cashLocal: 0, lifetime: { inflowIn: 500 } }))).toBe(0);
  });

  it("treats missing counters and a missing lifetime as zero", () => {
    expect(inferSeedLocal(pool({ cashLocal: 750 }))).toBeCloseTo(750, 2);
    const p = pool({ cashLocal: 750 });
    delete (p as { lifetime?: unknown }).lifetime;
    expect(inferSeedLocal(p)).toBeCloseTo(750, 2);
  });

  it("is idempotent in effect: re-inferring from the same ledger is stable", () => {
    const p = pool({
      cashLocal: 5_000,
      lifetime: { purchasesIn: 1_000, salesOut: 400, inflowIn: 200 },
    });
    expect(inferSeedLocal(p)).toBeCloseTo(inferSeedLocal(p), 6);
  });
});

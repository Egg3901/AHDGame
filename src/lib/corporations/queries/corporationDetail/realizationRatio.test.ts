import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { CorporateSector } from "@/lib/db/types";
import { computeRevenueRealizationRatio } from "./realizationRatio";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";

const CORP = { _id: new ObjectId() };
const identity = (amount: number) => amount;

function dbWith(latestRevenue: number | null | undefined) {
  return {
    collection: () => ({
      findOne: vi
        .fn()
        .mockResolvedValue(latestRevenue === undefined ? null : { revenue: latestRevenue }),
    }),
  } as unknown as Db;
}

function sector(revenue: number): CorporateSector {
  // productionPolicyLevel 0 ⇒ revenue multiplier of 1, so the arithmetic below
  // is exactly nameplate/TURNS_PER_DAY.
  return { revenue, productionPolicyLevel: 0, countryId: "US" } as CorporateSector;
}

describe("computeRevenueRealizationRatio (#587 / #925 / #2958)", () => {
  it("returns realized over nameplate hourly revenue", async () => {
    const sectors = [sector(2400), sector(1200)];
    const nameplateHourly = 3600 / TURNS_PER_DAY;
    const ratio = await computeRevenueRealizationRatio(
      dbWith(nameplateHourly * 0.6),
      CORP,
      sectors,
      identity
    );
    expect(ratio).toBeCloseTo(0.6, 10);
  });

  it("returns 1 when the corp has no history yet", async () => {
    // A brand-new corp has nothing to derive a correction from; falling back to
    // nameplate is the documented behaviour, not a silent zero.
    const ratio = await computeRevenueRealizationRatio(
      dbWith(undefined),
      CORP,
      [sector(1000)],
      identity
    );
    expect(ratio).toBe(1);
  });

  it("returns 1 rather than dividing by a zero nameplate", async () => {
    const ratio = await computeRevenueRealizationRatio(dbWith(500), CORP, [sector(0)], identity);
    expect(ratio).toBe(1);
  });

  it("returns 1 when the corp has no sectors at all", async () => {
    const ratio = await computeRevenueRealizationRatio(dbWith(500), CORP, [], identity);
    expect(ratio).toBe(1);
  });

  // The #925 shape: oversupplied sector, most output unsold. The ratio must go
  // BELOW one, which is what stops the page reporting a profit while the chart
  // plots a loss.
  it("goes below one when realized output trails nameplate", async () => {
    const sectors = [sector(4800)];
    const nameplateHourly = 4800 / TURNS_PER_DAY;
    const ratio = await computeRevenueRealizationRatio(
      dbWith(nameplateHourly * 0.25),
      CORP,
      sectors,
      identity
    );
    expect(ratio).toBeLessThan(1);
    expect(ratio).toBeCloseTo(0.25, 10);
  });

  it("never returns a negative ratio", async () => {
    const ratio = await computeRevenueRealizationRatio(
      dbWith(-100),
      CORP,
      [sector(1000)],
      identity
    );
    expect(ratio).toBe(0);
  });

  it("restates through the supplied currency conversion", async () => {
    const sectors = [sector(1000)];
    // Corp currency is 2x the host currency, so nameplate doubles and the same
    // realized figure yields half the ratio.
    const doubled = (amount: number) => amount * 2;
    const nameplateHourly = 2000 / TURNS_PER_DAY;
    const ratio = await computeRevenueRealizationRatio(
      dbWith(nameplateHourly),
      CORP,
      sectors,
      doubled
    );
    expect(ratio).toBeCloseTo(1, 10);
  });
});

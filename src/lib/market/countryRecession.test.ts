import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn(async () => undefined) }));

import { createSystemNewsPost } from "@/lib/news";
import {
  announceCountryRecessions,
  countryRecessionsFrom,
  recessionCapacityFactors,
  recessionPerTurnFactor,
  type CountryRecession,
} from "./countryRecession";

const jp: CountryRecession = { countryId: "JP", startTurn: 220, turns: 12, capacityCutPct: 10 };

describe("countryRecession factors", () => {
  it("compounds to exactly the configured cut over the window", () => {
    const f = recessionPerTurnFactor(jp);
    expect(Math.pow(f, 12)).toBeCloseTo(0.9, 10);
  });

  it("applies only inside the window and only to the configured country", () => {
    expect(recessionCapacityFactors([jp], 219).size).toBe(0);
    expect(recessionCapacityFactors([jp], 220).get("JP")).toBeCloseTo(recessionPerTurnFactor(jp));
    expect(recessionCapacityFactors([jp], 231).get("JP")).toBeCloseTo(recessionPerTurnFactor(jp));
    expect(recessionCapacityFactors([jp], 232).size).toBe(0);
    expect(recessionCapacityFactors([jp], 225).get("US")).toBeUndefined();
  });

  it("drops invalid entries", () => {
    expect(
      countryRecessionsFrom({
        countryRecessions: [
          jp,
          { ...jp, capacityCutPct: 0 },
          { ...jp, capacityCutPct: 80 },
          { ...jp, turns: 0 },
        ],
      })
    ).toEqual([jp]);
    expect(countryRecessionsFrom(null)).toEqual([]);
  });
});

describe("announceCountryRecessions", () => {
  const dbWith = (modifiedCount: number) =>
    ({
      collection: () => ({ updateOne: vi.fn(async () => ({ modifiedCount })) }),
    }) as unknown as Db;

  it("posts once when the claim succeeds on an active, unannounced recession", async () => {
    vi.mocked(createSystemNewsPost).mockClear();
    expect(await announceCountryRecessions(dbWith(1), [jp], 220)).toBe(1);
    expect(vi.mocked(createSystemNewsPost)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createSystemNewsPost).mock.calls[0][0]).not.toMatch(/[–—]/);
  });

  it("does not post when another run already claimed it, or before the start", async () => {
    vi.mocked(createSystemNewsPost).mockClear();
    expect(await announceCountryRecessions(dbWith(0), [jp], 220)).toBe(0);
    expect(await announceCountryRecessions(dbWith(1), [jp], 219)).toBe(0);
    expect(await announceCountryRecessions(dbWith(1), [{ ...jp, announcedAtTurn: 220 }], 221)).toBe(
      0
    );
    expect(vi.mocked(createSystemNewsPost)).not.toHaveBeenCalled();
  });
});

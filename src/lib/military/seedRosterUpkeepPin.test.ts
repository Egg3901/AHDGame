import { describe, it, expect, beforeEach } from "vitest";
import {
  captureSeedRosterUpkeepPin,
  pinnedUpkeep,
  resolveSeedRosterUpkeep,
  clearSeedRosterUpkeepPinCache,
  type SeedRosterUpkeepPin,
} from "./seedRosterUpkeepPin";
import { seedRosterUpkeepFor } from "./seedRosterUpkeep";
import type { Db } from "mongodb";

const stubDb = (pin: SeedRosterUpkeepPin | null): Db =>
  ({
    collection: () => ({
      findOne: async () => (pin ? { _id: "default", seedRosterUpkeep: pin } : { _id: "default" }),
    }),
  }) as unknown as Db;

beforeEach(() => clearSeedRosterUpkeepPinCache());

describe("captureSeedRosterUpkeepPin", () => {
  it("captures the RESOLVED value, so the late-founded armies are not left free", () => {
    // DE, DD, AT and NG seed nothing in 1953 because their armed forces are founded
    // later, and resolve through the nearest-preset search. Pinning the raw per-preset
    // table would drop all four, and a zero denominator is a free army.
    const pin = captureSeedRosterUpkeepPin("1953-default");
    for (const c of ["DE", "DD", "AT", "NG"]) {
      expect(pin.byCountry[c], c).toBeGreaterThan(0);
    }
  });

  it("agrees with the derived function it is capturing", () => {
    const pin = captureSeedRosterUpkeepPin("1953-default");
    for (const [countryId, value] of Object.entries(pin.byCountry)) {
      expect(value, countryId).toBe(seedRosterUpkeepFor("1953-default", countryId));
    }
  });

  it("records the preset it was captured for", () => {
    expect(captureSeedRosterUpkeepPin("1979-default").preset).toBe("1979-default");
  });
});

describe("pinnedUpkeep", () => {
  const pin: SeedRosterUpkeepPin = {
    preset: "1953-default",
    byCountry: { US: 4366, IE: 2226, BAD: 0, ALSOBAD: NaN },
  };

  it("returns the pinned value for the preset it covers", () => {
    expect(pinnedUpkeep(pin, "1953-default", "US")).toBe(4366);
  });

  it("never applies a pin from a different preset", () => {
    expect(pinnedUpkeep(pin, "1979-default", "US")).toBeNull();
  });

  it("treats a missing, zero or malformed entry as no pin, never as a free army", () => {
    // upkeepPerTurn DIVIDES by this. A zero denominator would make the army cost
    // nothing, which is worse than the drift the pin exists to prevent.
    expect(pinnedUpkeep(pin, "1953-default", "FR")).toBeNull();
    expect(pinnedUpkeep(pin, "1953-default", "BAD")).toBeNull();
    expect(pinnedUpkeep(pin, "1953-default", "ALSOBAD")).toBeNull();
    expect(pinnedUpkeep(null, "1953-default", "US")).toBeNull();
  });
});

describe("resolveSeedRosterUpkeep", () => {
  it("prefers the world's own pin over whatever the code says today", async () => {
    // The whole point: the live roster is a fact from turn one, so the denominator it
    // is charged against must not move when the seed table is edited.
    const db = stubDb({ preset: "1953-default", byCountry: { US: 4366 } });
    expect(await resolveSeedRosterUpkeep(db, "1953-default", "US")).toBe(4366);
  });

  it("falls back to derivation for a world seeded before pins existed", async () => {
    const db = stubDb(null);
    expect(await resolveSeedRosterUpkeep(db, "1953-default", "US")).toBe(
      seedRosterUpkeepFor("1953-default", "US")
    );
  });

  it("falls back for a country the pin does not cover", async () => {
    const db = stubDb({ preset: "1953-default", byCountry: { US: 4366 } });
    expect(await resolveSeedRosterUpkeep(db, "1953-default", "FR")).toBe(
      seedRosterUpkeepFor("1953-default", "FR")
    );
  });

  it("ignores a pin captured for another preset, which is the stale-reseed case", async () => {
    // gameConfig survives teardown, so a pin from the previous world can outlive it.
    // The preset guard is the second line of defence behind the seeder's rewrite.
    const db = stubDb({ preset: "2019-default", byCountry: { US: 999 } });
    expect(await resolveSeedRosterUpkeep(db, "1953-default", "US")).toBe(
      seedRosterUpkeepFor("1953-default", "US")
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  getLiveLowerChamberSeats,
  getLiveUpperChamberSeats,
  lowerChamberMajorityThreshold,
} from "./lowerChamberSeats";
import { getCountryConfig } from "@/lib/constants/countries";

function cursorOf<T>(docs: T[]) {
  const c = {
    sort: vi.fn(() => c),
    limit: vi.fn(() => c),
    project: vi.fn(() => c),
    toArray: vi.fn().mockResolvedValue(docs),
  };
  return c;
}

describe("lowerChamberMajorityThreshold", () => {
  it("is a simple majority of the chamber", () => {
    expect(lowerChamberMajorityThreshold(160)).toBe(81); // baseline Dáil
    expect(lowerChamberMajorityThreshold(225)).toBe(113); // Dáil after NI joins
    expect(lowerChamberMajorityThreshold(650)).toBe(326); // Commons
  });
});

describe("getLiveLowerChamberSeats", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("sums region houseDistricts (so a transferred-in region grows the chamber)", async () => {
    db.collection("states").find.mockReturnValue(
      cursorOf([{ houseDistricts: 160 }, { houseDistricts: 65 }])
    );
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "IE")).toBe(225);
  });

  it("falls back to the config size when no region carries houseDistricts", async () => {
    db.collection("states").find.mockReturnValue(cursorOf([]));
    // IE config lower chamber (Dáil) is 160.
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "IE")).toBe(160);
  });

  it("uses config (not the region sum) for mixed/list-tier systems like DE (AMS)", async () => {
    // DE region houseDistricts only cover the constituency tier — must NOT be
    // used as the chamber size; config is the SSOT.
    db.collection("states").find.mockReturnValue(cursorOf([{ houseDistricts: 299 }]));
    const deSeats = getCountryConfig("DE").legislature.lowerChamber.seats;
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "DE")).toBe(deSeats);
    expect(deSeats).not.toBe(299);
  });
});

describe("getLiveUpperChamberSeats", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("sums region stateSenateSeats for IE's region-apportioned Seanad (grows when NI joins)", async () => {
    db.collection("states").find.mockReturnValue(
      cursorOf([{ stateSenateSeats: 60 }, { stateSenateSeats: 24 }])
    );
    expect(await getLiveUpperChamberSeats(db as unknown as Db, "IE")).toBe(84);
  });

  it("returns the static config for a non-region-apportioned upper chamber (UK Lords)", async () => {
    // UK stateSenateSeats are the regional council, NOT the Lords — must not be summed.
    db.collection("states").find.mockReturnValue(cursorOf([{ stateSenateSeats: 488 }]));
    const lords = getCountryConfig("UK").legislature.upperChamber?.seats;
    expect(await getLiveUpperChamberSeats(db as unknown as Db, "UK")).toBe(lords);
    expect(lords).not.toBe(488);
  });

  it("sums region stateSenateSeats for SE 1953 First Chamber", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ preset: "1953-default" });
    // seRegions1953 totals 150; live sum must beat / match the override's 150 base.
    db.collection("states").find.mockReturnValue(
      cursorOf([
        { stateSenateSeats: 26 },
        { stateSenateSeats: 21 },
        { stateSenateSeats: 20 },
        { stateSenateSeats: 16 },
        { stateSenateSeats: 15 },
        { stateSenateSeats: 15 },
        { stateSenateSeats: 26 },
        { stateSenateSeats: 11 },
      ])
    );
    expect(await getLiveUpperChamberSeats(db as unknown as Db, "SE")).toBe(150);
  });

  it("does not sum SE stateSenateSeats outside 1953-default (1979 county-council weights)", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ preset: "1979-default" });
    // 1979 seRegions stateSenateSeats sum to 166 — must NOT replace abolished-era 151.
    db.collection("states").find.mockReturnValue(
      cursorOf([
        { stateSenateSeats: 30 },
        { stateSenateSeats: 28 },
        { stateSenateSeats: 20 },
        { stateSenateSeats: 18 },
        { stateSenateSeats: 18 },
        { stateSenateSeats: 16 },
        { stateSenateSeats: 24 },
        { stateSenateSeats: 12 },
      ])
    );
    expect(await getLiveUpperChamberSeats(db as unknown as Db, "SE")).toBe(151);
  });
});

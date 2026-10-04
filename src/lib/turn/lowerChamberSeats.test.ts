import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  getLiveLowerChamberSeats,
  getLiveUpperChamberSeats,
  lowerChamberMajorityThreshold,
} from "./lowerChamberSeats";
import { getCountryConfig } from "@/lib/constants/countries";
import {
  JP_SHUGIIN_1994_DISTRICT_SEATS,
  JP_SHUGIIN_1994_LIST_SEATS,
} from "@/lib/countries/jp/rules/shugiinElectoralLaw";

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
    expect(lowerChamberMajorityThreshold(650)).toBe(326); // modern Commons
    expect(lowerChamberMajorityThreshold(625)).toBe(313); // 1950–55 Commons
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

  it("tracks the 1991 Hungarian Assembly from 386 seats to 199 after its reform", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ preset: "1991-default" });
    db.collection("states").find.mockReturnValue(cursorOf([{ houseDistricts: 199 }]));
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "HU")).toBe(386);

    db.collection("gameState").findOne.mockResolvedValue({
      preset: "1991-default",
      huAssemblyReformedAtYear: 2014,
    });
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "HU")).toBe(199);
  });

  it("uses the 1953 Commons size (625) when the world preset is 1953-default", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ preset: "1953-default" });
    db.collection("states").find.mockReturnValue(cursorOf([]));
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "UK")).toBe(625);
  });

  it("uses the modern Commons size (650) outside 1953", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ preset: "2019-default" });
    db.collection("states").find.mockReturnValue(cursorOf([]));
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "UK")).toBe(650);
  });

  it("reads the durable Bulgarian ordinary Assembly transition", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ preset: "1991-default" });
    db.collection("countryGameStates").findOne.mockResolvedValue(null);
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "BG")).toBe(400);
    db.collection("countryGameStates").findOne.mockResolvedValue({
      bgOrdinaryAssemblySinceTurn: 41,
    });
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "BG")).toBe(240);
  });

  it("keeps Japan's sitting chamber until each region resolves under its frozen rule", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ preset: "1991-default" });
    const countryStates = db.collection("countryGameStates");
    countryStates.findOne.mockResolvedValue({
      _id: "JP",
      jpShugiinElectoralMandate: {
        law: "mixed-1994-v1",
        passedTurn: 88,
        billId: "bill-1994-reform",
      },
    });
    // Approval changes only future races; the current 512-seat chamber stays intact.
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "JP")).toBe(512);

    countryStates.findOne.mockResolvedValue({
      _id: "JP",
      jpShugiinElectoralMandate: {
        law: "mixed-1994-v1",
        passedTurn: 88,
        billId: "bill-1994-reform",
      },
      jpShugiinResolvedRegionalRules: {
        KAN: {
          ruleVersion: "mixed-1994-v1",
          totalSeats: 148,
          districtSeats: 85,
          listSeats: 63,
          electionId: "election-kan",
          cycle: 1,
          resolvedAtTurn: 100,
        },
      },
    });
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "JP")).toBe(515);

    const fullyTurnedOver = Object.fromEntries(
      Object.entries(JP_SHUGIIN_1994_DISTRICT_SEATS).map(([regionId, districtSeats]) => [
        regionId,
        {
          ruleVersion: "mixed-1994-v1" as const,
          totalSeats: districtSeats + JP_SHUGIIN_1994_LIST_SEATS[regionId],
          districtSeats,
          listSeats: JP_SHUGIIN_1994_LIST_SEATS[regionId],
          electionId: `election-${regionId}`,
          cycle: 1,
          resolvedAtTurn: 100,
        },
      ])
    );
    countryStates.findOne.mockResolvedValue({
      _id: "JP",
      jpShugiinElectoralMandate: {
        law: "mixed-1994-v1",
        passedTurn: 88,
        billId: "bill-1994-reform",
      },
      jpShugiinResolvedRegionalRules: fullyTurnedOver,
    });
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "JP")).toBe(500);
  });

  it("reads both Romanian chambers from the durable 1992 transition marker", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ preset: "1991-default" });
    db.collection("countryGameStates").findOne.mockResolvedValue({ _id: "RO" });
    db.collection("states").find.mockReturnValue(cursorOf([]));
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "RO")).toBe(396);
    expect(await getLiveUpperChamberSeats(db as unknown as Db, "RO")).toBe(119);
    db.collection("countryGameStates").findOne.mockResolvedValue({
      _id: "RO",
      roParliament1992SinceTurn: 96,
    });
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "RO")).toBe(341);
    expect(await getLiveUpperChamberSeats(db as unknown as Db, "RO")).toBe(143);
    db.collection("states").find.mockReturnValue(
      cursorOf([
        { houseDistricts: 200, stateSenateSeats: 80 },
        { houseDistricts: 150, stateSenateSeats: 70 },
      ])
    );
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "RO")).toBe(350);
    expect(await getLiveUpperChamberSeats(db as unknown as Db, "RO")).toBe(150);
  });

  it("reads the Russian Congress dissolution and first Duma seat count", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ preset: "1991-default" });
    db.collection("countryGameStates").findOne.mockResolvedValue({
      ruCongressDissolvedSinceTurn: 129,
    });
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "RU")).toBe(0);
    db.collection("countryGameStates").findOne.mockResolvedValue({
      ruCongressDissolvedSinceTurn: 129,
      ruFederalAssemblySinceTurn: 145,
    });
    expect(await getLiveLowerChamberSeats(db as unknown as Db, "RU")).toBe(450);
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

  it("opens the first Russian Federation Council at 178 seats", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ preset: "1991-default" });
    db.collection("countryGameStates").findOne.mockResolvedValue({
      ruCongressDissolvedSinceTurn: 129,
    });
    expect(await getLiveUpperChamberSeats(db as unknown as Db, "RU")).toBe(0);
    db.collection("countryGameStates").findOne.mockResolvedValue({
      ruFederalAssemblySinceTurn: 145,
    });
    expect(await getLiveUpperChamberSeats(db as unknown as Db, "RU")).toBe(178);
  });
});

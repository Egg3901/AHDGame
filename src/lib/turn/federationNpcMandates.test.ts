import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { csRegions1991 } from "@/lib/countries/cs/data/csRegions1991";
import { yuRegions1991 } from "@/lib/countries/yu/data/yuRegions1991";
import {
  getLowerChamberOfficeType,
  getUpperChamberOfficeType,
} from "@/lib/legislature/chamberOfficeType";
import { defaultNpcCustodians } from "@/lib/world/succession/defaultProposal";
import { processFederationNpcMandates } from "./federationNpcMandates";

describe("autonomous federation mandates", () => {
  it("opens one ordinary CS bill after the date and leaves the outcome to voting", async () => {
    const mem = createInMemoryDb();
    mem.seed("gameState", [
      { _id: "current", preset: "1991-default", currentYear: 1992, currentTurn: 96 },
    ]);
    mem.seed("states", csRegions1991 as unknown as Record<string, unknown>[]);
    mem.seed("electedOfficials", [
      {
        _id: new ObjectId(),
        countryId: "CS",
        officeType: getLowerChamberOfficeType("CS", "1991-default"),
        nppId: new ObjectId(),
        characterId: null,
      },
    ]);
    const db = mem as unknown as Db;
    expect(await processFederationNpcMandates(db, "1991-default", 1992, new Date(0))).toBe(1);
    expect(await processFederationNpcMandates(db, "1991-default", 1992, new Date(0))).toBe(0);
    const bill = await mem.collection("bills").findOne({ countryId: "CS" });
    expect(bill).toMatchObject({
      status: "active",
      federationSettlementMandate: { sourceEntityId: "CS" },
    });
    expect(await mem.collection("federationRatifications").countDocuments({})).toBe(0);
    expect(await mem.collection("federationSettlementApplications").countDocuments({})).toBe(0);
  });

  it("waits for the date and preserves a player-held federal choice", async () => {
    const mem = createInMemoryDb();
    mem.seed("gameState", [
      { _id: "current", preset: "1991-default", currentYear: 1992, currentTurn: 96 },
    ]);
    mem.seed("states", csRegions1991 as unknown as Record<string, unknown>[]);
    mem.seed("electedOfficials", [
      {
        _id: new ObjectId(),
        countryId: "CS",
        officeType: getLowerChamberOfficeType("CS", "1991-default"),
        nppId: new ObjectId(),
        characterId: new ObjectId(),
      },
    ]);
    const db = mem as unknown as Db;
    expect(await processFederationNpcMandates(db, "1991-default", 1991, new Date(0))).toBe(0);
    expect(await processFederationNpcMandates(db, "1991-default", 1992, new Date(0))).toBe(0);
    expect(await mem.collection("bills").countDocuments({})).toBe(0);
  });

  it("waits for an NPP government if a formation record is pending", async () => {
    const mem = createInMemoryDb();
    const nppId = new ObjectId();
    mem.seed("gameState", [
      { _id: "current", preset: "1991-default", currentYear: 1992, currentTurn: 96 },
    ]);
    mem.seed("states", csRegions1991 as unknown as Record<string, unknown>[]);
    mem.seed("electedOfficials", [
      {
        _id: new ObjectId(),
        countryId: "CS",
        officeType: getLowerChamberOfficeType("CS", "1991-default"),
        nppId,
        characterId: null,
      },
    ]);
    mem.seed("governmentFormations", [
      { _id: "CS", status: "pending", pmCharacterId: null, pmNppId: null },
    ]);
    const db = mem as unknown as Db;
    expect(await processFederationNpcMandates(db, "1991-default", 1992, new Date(0))).toBe(0);
    await mem
      .collection("governmentFormations")
      .updateOne({ _id: "CS" }, { $set: { status: "formed", pmNppId: nppId } });
    expect(await processFederationNpcMandates(db, "1991-default", 1992, new Date(0))).toBe(1);
  });

  it("does not bypass a player in Yugoslavia's appointed upper chamber", async () => {
    const mem = createInMemoryDb();
    mem.seed("gameState", [
      { _id: "current", preset: "1991-default", currentYear: 1991, currentTurn: 1 },
    ]);
    mem.seed("states", yuRegions1991 as unknown as Record<string, unknown>[]);
    mem.seed("electedOfficials", [
      {
        _id: new ObjectId(),
        countryId: "YU",
        officeType: getLowerChamberOfficeType("YU", "1991-default"),
        nppId: new ObjectId(),
        characterId: null,
      },
      {
        _id: new ObjectId(),
        countryId: "YU",
        officeType: getUpperChamberOfficeType("YU", "1991-default"),
        nppId: null,
        characterId: new ObjectId(),
      },
    ]);
    expect(
      await processFederationNpcMandates(mem as unknown as Db, "1991-default", 1991, new Date(0))
    ).toBe(0);
  });

  it("publishes explicit shared-asset custody in the NPC opening position", () => {
    expect(
      defaultNpcCustodians(
        [
          { entityId: "SK", population: 5, regionIds: ["S"], annualGdpAnchor: 1 },
          { entityId: "CZ2", population: 10, regionIds: ["C"], annualGdpAnchor: 2 },
        ],
        [
          { assetId: "strategic", kind: "strategic-force", homeRegionId: "S" },
          { assetId: "unlocated", kind: "public-enterprise", homeRegionId: null },
          { assetId: "local", kind: "conventional-force", homeRegionId: "S" },
        ]
      )
    ).toEqual({ strategic: "CZ2", unlocated: "CZ2" });
  });
});

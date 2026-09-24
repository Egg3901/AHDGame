import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  assessWarEntryPoliticalPressure,
  classifyWarEntry,
  enactImmediateWarEntry,
  loadCollectiveDefenseEntryBlocks,
  warEntryIsImmediate,
} from "../warEntryPolicy";

const { mobilize } = vi.hoisted(() => ({ mobilize: vi.fn().mockResolvedValue(2) }));
vi.mock("@/lib/nppAutonomy/autonomousWarCommands", () => ({
  mobilizeImmediateWarEntry: (...args: unknown[]) => mobilize(...args),
}));

const germany = {
  _id: "war_us_dd_415",
  name: "The War for Germany",
  hostCountry: "DD",
  hostEntities: ["DD", "DE"],
  sideA: { label: "United States", countries: ["US"], kind: "state" },
  sideB: { label: "East Germany", countries: ["DD", "RU"], kind: "coalition" },
  control: 50,
} as unknown as ConflictDoc;

describe("war entry stakes", () => {
  it("makes West Germany a principal belligerent in a war over both Germanies", () => {
    const stake = classifyWarEntry({
      conflict: germany,
      countryId: "DE",
      side: "A",
      organizationId: "NATO",
    });
    expect(stake).toBe("principal_belligerent");
    expect(warEntryIsImmediate(stake)).toBe(true);
  });

  it("treats Warsaw Pact entry on East Germany's side as collective defense", () => {
    const stake = classifyWarEntry({
      conflict: germany,
      countryId: "PL",
      side: "B",
      organizationId: "WARSAW_PACT",
    });
    expect(stake).toBe("collective_defense");
    expect(warEntryIsImmediate(stake)).toBe(true);
  });

  it("keeps NATO entry on the attacking side legislative", () => {
    const stake = classifyWarEntry({
      conflict: germany,
      countryId: "FR",
      side: "A",
      organizationId: "NATO",
    });
    expect(stake).toBe("offensive_coalition");
    expect(warEntryIsImmediate(stake)).toBe(false);
  });

  it("treats a player-founded Bloc's defensive call as collective defense", () => {
    const stake = classifyWarEntry({
      conflict: germany,
      countryId: "PL",
      side: "B",
      organizationId: "andes-pact",
      organization: {
        category: "bloc",
        foundingMembers: ["BR"],
        alignment: { poleId: "ORG:andes-pact", accentToken: "warning" },
      },
    });
    expect(stake).toBe("collective_defense");
    expect(warEntryIsImmediate(stake)).toBe(true);
  });

  it("treats a widened theatre's attacked applicant as collective defence", () => {
    const stake = classifyWarEntry({
      conflict: {
        ...germany,
        sideA: { ...germany.sideA, countries: ["US", "DE"] },
      },
      countryId: "FR",
      side: "A",
      organizationId: "NATO",
      defendingCountryId: "DE",
    });
    expect(stake).toBe("collective_defense");
    expect(warEntryIsImmediate(stake)).toBe(true);
  });

  it("enacts collective defense immediately and records the treaty entry", async () => {
    const db = createMockDb();
    const conflict = structuredClone(germany);

    const result = await enactImmediateWarEntry({
      db: db as unknown as Db,
      conflict,
      countryId: "PL",
      side: "B",
      organizationId: "WARSAW_PACT",
      currentTurn: 458,
      stake: "collective_defense",
    });

    expect(result).toEqual({ joined: true, deployedUnits: 2 });
    expect(conflict.sideB.countries).toContain("PL");
    expect(conflict.treatyEntries).toContainEqual({
      countryId: "PL",
      organizationId: "WARSAW_PACT",
      defending: "DD",
      joinedTurn: 458,
    });
  });
});

describe("collective defence entry blocks", () => {
  it("batches active truces and parallel wars across the opposing roster", async () => {
    const db = createMockDb();
    db.collection("truces");
    db.collection("conflicts");
    db.collectionMocks.truces.find.mockReturnValue(
      createAsyncIterableCursor([{ _id: "FR__RU", countries: ["FR", "RU"], expiresTurn: 900 }])
    );
    db.collectionMocks.conflicts.find.mockReturnValue(
      createAsyncIterableCursor([
        {
          _id: "other-war",
          status: "active",
          sideA: { countries: ["UK"] },
          sideB: { countries: ["RU"] },
        },
      ])
    );

    const result = await loadCollectiveDefenseEntryBlocks({
      db: db as unknown as Db,
      conflict: germany,
      candidates: ["FR", "UK"],
      opponents: ["RU"],
      currentTurn: 500,
    });

    expect(result).toEqual(
      new Map([
        ["FR", "an active truce with RU"],
        ["UK", "an existing war with RU"],
      ])
    );
    expect(db.collectionMocks.truces.find).toHaveBeenCalledOnce();
    expect(db.collectionMocks.conflicts.find).toHaveBeenCalledOnce();
  });
});

describe("offensive coalition pressure", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("countryAlignments").findOne.mockResolvedValue({
      entityId: "FR",
      shares: { WEST: 80, EAST: 20 },
      nonAligned: 0,
    });
    db.collection("sphereMemberships").findOne.mockResolvedValue({
      entityId: "FR",
      primarySphereId: "US",
      relationships: [],
    });
    db.collection("governmentApprovals").findOne.mockResolvedValue({ approvalRating: 60 });
    db.collection("federalBudget").findOne.mockResolvedValue({ debtToGdpRatio: 100 });
    db.collection("militaryUnits").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          theaterId: "reserve",
          personnel: 10_000,
          readiness: 75,
          readyAtTurn: 1,
        },
      ]),
    });
  });

  it("lets strong bloc relations overcome some offensive-war resistance", async () => {
    const pressure = await assessWarEntryPoliticalPressure({
      db: db as unknown as Db,
      countryId: "FR",
      organizationId: "NATO",
      stake: "offensive_coalition",
      currentTurn: 458,
    });

    expect(pressure.securityStakes).toBe(-15);
    expect(pressure.blocRelations).toBe(33);
    expect(pressure.total).toBe(23);
  });

  it("prices a custom Bloc's own pole and founder sphere tie", async () => {
    db.collection("countryAlignments").findOne.mockResolvedValue({
      entityId: "FR",
      shares: { WEST: 10, EAST: 20, "ORG:andes-pact": 60 },
      nonAligned: 10,
    });
    db.collection("sphereMemberships").findOne.mockResolvedValue({
      entityId: "FR",
      primarySphereId: "BR",
      relationships: [],
    });

    const pressure = await assessWarEntryPoliticalPressure({
      db: db as unknown as Db,
      countryId: "FR",
      organizationId: "andes-pact",
      organization: {
        category: "bloc",
        foundingMembers: ["BR"],
        alignment: { poleId: "ORG:andes-pact", accentToken: "warning" },
      },
      stake: "offensive_coalition",
      currentTurn: 458,
    });

    expect(pressure.blocRelations).toBe(26);
  });
});

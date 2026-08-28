import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  assessWarEntryPoliticalPressure,
  classifyWarEntry,
  enactImmediateWarEntry,
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
});

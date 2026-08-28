import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { ForeignPolicyChoice } from "../foreignPolicy";

const { activeMock } = vi.hoisted(() => ({ activeMock: vi.fn() }));

vi.mock("../featureFlag", () => ({
  isNppAutonomyActive: (...args: unknown[]) => activeMock(...args),
}));

import { processAutonomousForeignPolicy } from "../foreignPolicy";

const now = new Date("2026-08-27T12:00:00.000Z");
const headId = new ObjectId();

interface PlannerFixture {
  mode?: "off" | "shadow" | "active";
  alignments?: Array<Record<string, unknown>>;
  spheres?: Array<Record<string, unknown>>;
  memberships?: Array<Record<string, unknown>>;
  conflicts?: Array<Record<string, unknown>>;
  pendingMemberships?: Array<Record<string, unknown>>;
  embargoes?: Array<Record<string, unknown>>;
  bills?: Array<Record<string, unknown>>;
  tradeSnapshot?: Record<string, unknown> | null;
}

interface RecordedDecision {
  selected: ForeignPolicyChoice | null;
  alternatives: ForeignPolicyChoice[];
  acted: false;
  mode: "shadow" | "active";
}

function setFindRows(db: MockDb, collectionName: string, rows: Array<Record<string, unknown>>) {
  db.collection(collectionName).find().toArray.mockResolvedValue(rows);
}

function setup(fixture: PlannerFixture = {}): MockDb {
  const db = createMockDb();
  db.collection("gameState").findOne.mockResolvedValue({
    _id: "current",
    nppForeignPolicyMode: fixture.mode ?? "shadow",
  });
  db.collection("governmentFormations").findOne.mockResolvedValue({
    _id: "FR",
    status: "formed",
    pmNppId: headId,
  });
  db.collection("npps").findOne.mockResolvedValue({
    _id: headId,
    countryId: "FR",
    name: "French Premier",
    policies: { economic: 0, social: 0, domainPositions: { trade: 0, defense: 0 } },
    personality: { ambition: 50, stubbornness: 50, loyalty: 50 },
  });
  db.collection("federalBudget").findOne.mockResolvedValue({
    countryId: "FR",
    debtToGdpRatio: 40,
  });
  db.collection("tradeFlowSnapshots").findOne.mockResolvedValue(fixture.tradeSnapshot ?? null);

  setFindRows(db, "countryAlignments", fixture.alignments ?? []);
  setFindRows(db, "sphereMemberships", fixture.spheres ?? []);
  setFindRows(db, "organizationMemberships", fixture.memberships ?? []);
  setFindRows(db, "conflicts", fixture.conflicts ?? []);
  setFindRows(db, "tradeEmbargoes", fixture.embargoes ?? []);
  setFindRows(db, "tariffs", []);
  setFindRows(db, "bills", fixture.bills ?? []);
  setFindRows(db, "organizationLegislation", []);
  setFindRows(db, "organizationMembershipProposals", fixture.pendingMemberships ?? []);
  setFindRows(db, "organizationLeadershipElections", []);
  db.collection("nppForeignPolicyDecisions").updateOne.mockResolvedValue({
    matchedCount: 0,
    modifiedCount: 0,
    upsertedCount: 1,
  });
  return db;
}

function recordedDecision(db: MockDb): RecordedDecision {
  const updateOne = db.collection("nppForeignPolicyDecisions").updateOne;
  const update = updateOne.mock.calls.at(-1)?.[1] as { $setOnInsert: RecordedDecision };
  return update.$setOnInsert;
}

function expectNoGameplayWrites(db: MockDb): void {
  for (const [name, collection] of Object.entries(db.collectionMocks)) {
    if (name === "nppForeignPolicyDecisions") continue;
    expect(collection.insertOne, `${name}.insertOne`).not.toHaveBeenCalled();
    expect(collection.insertMany, `${name}.insertMany`).not.toHaveBeenCalled();
    expect(collection.updateOne, `${name}.updateOne`).not.toHaveBeenCalled();
    expect(collection.updateMany, `${name}.updateMany`).not.toHaveBeenCalled();
    expect(collection.deleteOne, `${name}.deleteOne`).not.toHaveBeenCalled();
    expect(collection.deleteMany, `${name}.deleteMany`).not.toHaveBeenCalled();
    expect(collection.bulkWrite, `${name}.bulkWrite`).not.toHaveBeenCalled();
  }
}

function alignment(entityId: "FR" | "IT" | "RU", west: number, east: number) {
  return {
    _id: new ObjectId(),
    entityId,
    eraKey: "cold-war",
    shares: { WEST: west, EAST: east },
    nonAligned: Math.max(0, 100 - west - east),
    previous: null,
    turn: 10,
    updatedAt: now,
  };
}

function membership(countryId: "FR" | "IT" | "RU", organizationId = "NATO") {
  return {
    _id: new ObjectId(),
    organizationId,
    countryId,
    status: "active",
    joinedAt: now,
    joinedTurn: 1,
  };
}

function pendingMembership(proposingCountryId: "IT" | "RU") {
  return {
    _id: new ObjectId(),
    organizationId: "NATO",
    proposingCountryId,
    status: "pending",
    votes: [],
  };
}

beforeEach(() => {
  activeMock.mockReset().mockResolvedValue(true);
});

describe("processAutonomousForeignPolicy", () => {
  it("records a cooperative yes vote from alignment, sphere, and organization ties", async () => {
    const db = setup({
      alignments: [alignment("FR", 80, 0), alignment("IT", 80, 0)],
      spheres: [
        {
          _id: "FR",
          entityId: "FR",
          primarySphereId: "US",
          relationships: [],
        },
        {
          _id: "IT",
          entityId: "IT",
          primarySphereId: "US",
          relationships: [],
        },
      ],
      memberships: [membership("FR"), membership("IT")],
      pendingMemberships: [pendingMembership("IT")],
    });

    const result = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 10, now);

    expect(result).toMatchObject({
      ran: true,
      mode: "shadow",
      acted: false,
      decisionRecorded: true,
    });
    expect(result.choice).toMatchObject({ type: "vote_org_yes", targetCountryId: "IT" });
    expect(recordedDecision(db).alternatives[0].reasons.join(" ")).toContain("share the US sphere");
    expectNoGameplayWrites(db);
  });

  it("votes no on a hostile application instead of approving every proposal", async () => {
    const db = setup({
      alignments: [alignment("FR", 100, 0), alignment("RU", 0, 100)],
      memberships: [membership("FR")],
      pendingMemberships: [pendingMembership("RU")],
    });

    const result = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 11, now);

    expect(result.choice).toMatchObject({ type: "vote_org_no", targetCountryId: "RU" });
  });

  it("uses trade dependence as a brake on escalating from tariffs to embargo", async () => {
    const common = {
      alignments: [alignment("FR", 100, 0), alignment("RU", 0, 100)],
      conflicts: [
        {
          _id: "east-west-war",
          name: "East-West War",
          status: "active",
          sideA: { label: "West", countries: ["FR"] },
          sideB: { label: "East", countries: ["RU"] },
        },
      ],
    };
    const noTradeDb = setup(common);
    const tradeDb = setup({
      ...common,
      tradeSnapshot: {
        turn: 12,
        commodities: {
          oil: {
            flow: { FR: { RU: 60 }, RU: { FR: 40 } },
          },
        },
        national: { FR: { exports: 100, imports: 100, net: 0 } },
      },
    });

    const noTrade = await processAutonomousForeignPolicy(noTradeDb as unknown as Db, "FR", 12, now);
    const withTrade = await processAutonomousForeignPolicy(tradeDb as unknown as Db, "FR", 12, now);

    expect(noTrade.choice?.type).toBe("impose_embargo");
    expect(withTrade.choice?.type).toBe("raise_tariff");
    const embargo = recordedDecision(tradeDb).alternatives.find(
      (choice) => choice.type === "impose_embargo"
    );
    expect(embargo?.reasons.join(" ")).toContain("trade dependence applies a 15 point brake");
  });

  it("counts an embargo relationship once and only proposes powers an organization has", async () => {
    const db = setup({
      alignments: [alignment("FR", 100, 0), alignment("RU", 0, 100)],
      memberships: [membership("FR", "UN"), membership("RU", "UN")],
      embargoes: ["oil", "steel", "grain"].map((commodity) => ({
        _id: new ObjectId(),
        sourceCountry: "FR",
        targetCountry: "RU",
        commodity,
        imposedTurn: 1,
        expiresTurn: null,
      })),
    });

    await processAutonomousForeignPolicy(db as unknown as Db, "FR", 12, now);

    const alternatives = recordedDecision(db).alternatives;
    expect(alternatives).not.toContainEqual(
      expect.objectContaining({ type: "propose_sanctions", organizationId: "UN" })
    );
    expect(alternatives).toContainEqual(
      expect.objectContaining({ type: "condemn_country", organizationId: "UN" })
    );
    const embargoReasons = alternatives
      .find((choice) => choice.type === "raise_tariff" && choice.targetCountryId === "RU")
      ?.reasons.filter((reason) => reason === "The government currently embargoes this country.");
    expect(embargoReasons).toHaveLength(1);
  });

  it("does not plan another tariff while a targeted tariff bill is pending", async () => {
    const db = setup({
      alignments: [alignment("FR", 100, 0), alignment("RU", 0, 100)],
      bills: [
        {
          _id: new ObjectId(),
          countryId: "FR",
          status: "active",
          provisions: [
            {
              type: "tariff",
              scopeType: "origin_country",
              targetOriginCountryId: "RU",
              rate: 15,
            },
          ],
        },
      ],
    });

    await processAutonomousForeignPolicy(db as unknown as Db, "FR", 12, now);

    expect(recordedDecision(db).alternatives).not.toContainEqual(
      expect.objectContaining({ type: "raise_tariff", targetCountryId: "RU" })
    );
  });

  it("is idempotent for the same country and turn", async () => {
    const db = setup();
    db.collection("nppForeignPolicyDecisions")
      .updateOne.mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0, upsertedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 0, upsertedCount: 0 });

    const first = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 13, now);
    const second = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 13, now);

    expect(first.decisionRecorded).toBe(true);
    expect(second.decisionRecorded).toBe(false);
    expect(db.collection("nppForeignPolicyDecisions").updateOne).toHaveBeenCalledTimes(2);
  });

  it("honors the player and autonomy rail before loading or writing policy", async () => {
    activeMock.mockResolvedValue(false);
    const db = setup();

    const result = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 14, now);

    expect(result).toMatchObject({ ran: false, skipReason: "inactive", acted: false });
    expect(db.collection("governmentFormations").findOne).not.toHaveBeenCalled();
    expect(db.collection("nppForeignPolicyDecisions").updateOne).not.toHaveBeenCalled();
  });

  it("keeps active rollout non-mutating until execution adapters land", async () => {
    const db = setup({ mode: "active" });

    const result = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 15, now);

    expect(result).toMatchObject({ mode: "active", acted: false });
    expect(recordedDecision(db)).toMatchObject({ mode: "active", acted: false });
    expectNoGameplayWrites(db);
  });
});

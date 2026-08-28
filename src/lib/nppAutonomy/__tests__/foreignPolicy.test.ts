import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { ForeignPolicyChoice } from "../foreignPolicy";

const { activeMock, executionMock } = vi.hoisted(() => ({
  activeMock: vi.fn(),
  executionMock: vi.fn(),
}));

vi.mock("../featureFlag", () => ({
  isNppAutonomyActive: (...args: unknown[]) => activeMock(...args),
}));
vi.mock("../foreignPolicyActions", () => ({
  executeForeignPolicyChoice: (...args: unknown[]) => executionMock(...args),
}));

import { processAutonomousForeignPolicy } from "../foreignPolicy";

const now = new Date("2026-08-27T12:00:00.000Z");
const headId = new ObjectId();

interface PlannerFixture {
  mode?: "off" | "shadow" | "active";
  stage?: "votes" | "proposals" | "trade" | "support" | "war";
  alignments?: Array<Record<string, unknown>>;
  spheres?: Array<Record<string, unknown>>;
  memberships?: Array<Record<string, unknown>>;
  conflicts?: Array<Record<string, unknown>>;
  pendingMemberships?: Array<Record<string, unknown>>;
  embargoes?: Array<Record<string, unknown>>;
  bills?: Array<Record<string, unknown>>;
  tradeSnapshot?: Record<string, unknown> | null;
  recentDecisions?: Array<Record<string, unknown>>;
  militaryUnits?: Array<Record<string, unknown>>;
  approvalRating?: number;
}

interface RecordedDecision {
  selected: ForeignPolicyChoice | null;
  alternatives: ForeignPolicyChoice[];
  acted: boolean;
  mode: "shadow" | "active";
  stage: "votes" | "proposals" | "trade" | "support" | "war";
  executionStatus: "planned" | "claimed" | "executed" | "rejected" | "no_action";
}

function setFindRows(db: MockDb, collectionName: string, rows: Array<Record<string, unknown>>) {
  db.collection(collectionName).find().toArray.mockResolvedValue(rows);
}

function setup(fixture: PlannerFixture = {}): MockDb {
  const db = createMockDb();
  db.collection("gameState").findOne.mockResolvedValue({
    _id: "current",
    nppForeignPolicyMode: fixture.mode ?? "shadow",
    nppForeignPolicyStage: fixture.stage,
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
  db.collection("governmentApprovals").findOne.mockResolvedValue(
    fixture.approvalRating === undefined
      ? null
      : { _id: "FR", countryId: "FR", approvalRating: fixture.approvalRating }
  );

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
  setFindRows(db, "nppForeignPolicyDecisions", fixture.recentDecisions ?? []);
  setFindRows(db, "militaryUnits", fixture.militaryUnits ?? []);
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

function firstRecordedDecision(db: MockDb): RecordedDecision {
  const updateOne = db.collection("nppForeignPolicyDecisions").updateOne;
  const update = updateOne.mock.calls[0]?.[1] as { $setOnInsert: RecordedDecision };
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

function alignment(entityId: "FR" | "IT" | "RU" | "US", west: number, east: number) {
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

function membership(countryId: "FR" | "IT" | "RU" | "US", organizationId = "NATO") {
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
  executionMock.mockReset().mockResolvedValue({ acted: true, note: "Executed test choice." });
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

    await processAutonomousForeignPolicy(noTradeDb as unknown as Db, "FR", 12, now);
    await processAutonomousForeignPolicy(tradeDb as unknown as Db, "FR", 12, now);

    const noTradeEmbargo = recordedDecision(noTradeDb).alternatives.find(
      (choice) => choice.type === "impose_embargo"
    );
    const embargo = recordedDecision(tradeDb).alternatives.find(
      (choice) => choice.type === "impose_embargo"
    );
    expect(noTradeEmbargo?.score).toBeGreaterThan(embargo?.score ?? 0);
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

  it("prevents tariff and embargo reversal inside the pair cooldown", async () => {
    const db = setup({
      alignments: [alignment("FR", 100, 0), alignment("RU", 0, 100)],
      recentDecisions: [
        {
          _id: new ObjectId(),
          countryId: "FR",
          turn: 20,
          mode: "shadow",
          selected: {
            type: "impose_embargo",
            score: 50,
            targetCountryId: "RU",
            reasons: [],
          },
        },
      ],
    });

    await processAutonomousForeignPolicy(db as unknown as Db, "FR", 40, now);

    expect(
      recordedDecision(db).alternatives.some(
        (choice) => choice.type === "impose_embargo" && choice.targetCountryId === "RU"
      )
    ).toBe(false);
  });

  it("only offers alliance war entry when approval, forces, and readiness clear the guard", async () => {
    const conflict = {
      _id: "korea",
      name: "Korean War",
      status: "active",
      sideA: { label: "UN Coalition", countries: ["US"] },
      sideB: { label: "Communist Coalition", countries: ["RU"] },
    };
    const common = {
      alignments: [alignment("FR", 90, 0), alignment("US", 100, 0), alignment("RU", 0, 100)],
      memberships: [membership("FR"), membership("US")],
      conflicts: [conflict],
      militaryUnits: [
        {
          _id: new ObjectId(),
          countryId: "FR",
          readiness: 72,
          personnel: 10_000,
          theaterId: "reserve",
          basePower: 100,
        },
      ],
    };
    const readyDb = setup({ ...common, approvalRating: 60 });
    const opposedDb = setup({ ...common, approvalRating: 30 });

    await processAutonomousForeignPolicy(readyDb as unknown as Db, "FR", 41, now);
    await processAutonomousForeignPolicy(opposedDb as unknown as Db, "FR", 41, now);

    expect(recordedDecision(readyDb).alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "join_war", conflictId: "korea", conflictSide: "A" }),
      ])
    );
    expect(
      recordedDecision(opposedDb).alternatives.some((choice) => choice.type === "join_war")
    ).toBe(false);
  });

  it("uses an economic bloc for material support when the ally shares one", async () => {
    const conflict = {
      _id: "germany",
      name: "The War for Germany",
      status: "active",
      sideA: { label: "West", countries: ["US"] },
      sideB: { label: "East", countries: ["RU"] },
    };
    const db = setup({
      alignments: [alignment("FR", 90, 0), alignment("US", 100, 0), alignment("RU", 0, 100)],
      memberships: [
        membership("FR", "NATO"),
        membership("US", "NATO"),
        membership("FR", "COMECON"),
        membership("US", "COMECON"),
      ],
      conflicts: [conflict],
      approvalRating: 60,
    });

    await processAutonomousForeignPolicy(db as unknown as Db, "FR", 41, now);

    expect(recordedDecision(db).alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "support_war",
          conflictId: "germany",
          organizationId: "COMECON",
        }),
      ])
    );
  });

  it("offers real operations or peace after an autonomous country enters a war", async () => {
    const conflict = {
      _id: "korea",
      name: "Korean War",
      status: "active",
      sideA: { label: "UN Coalition", countries: ["FR", "US"] },
      sideB: { label: "Communist Coalition", countries: ["RU"] },
    };
    const deployedUnit = {
      _id: new ObjectId(),
      countryId: "FR",
      readiness: 70,
      personnel: 10_000,
      theaterId: "korea",
      basePower: 100,
    };
    const fightingDb = setup({
      conflicts: [conflict],
      militaryUnits: [deployedUnit],
      approvalRating: 60,
    });
    const exhaustedDb = setup({
      conflicts: [conflict],
      militaryUnits: [{ ...deployedUnit, readiness: 25 }],
      approvalRating: 25,
    });

    const _fighting = await processAutonomousForeignPolicy(
      fightingDb as unknown as Db,
      "FR",
      42,
      now
    );
    const _exhausted = await processAutonomousForeignPolicy(
      exhaustedDb as unknown as Db,
      "FR",
      42,
      now
    );

    expect(recordedDecision(fightingDb).alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "conduct_war", conflictId: "korea" }),
      ])
    );
    expect(recordedDecision(exhaustedDb).alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "seek_peace",
          conflictId: "korea",
          targetCountryId: "RU",
        }),
      ])
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

  it("does not call an action adapter when active mode has no qualifying choice", async () => {
    const db = setup({ mode: "active" });

    const result = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 15, now);

    expect(result).toMatchObject({ mode: "active", acted: false });
    expect(recordedDecision(db)).toMatchObject({
      mode: "active",
      acted: false,
      executionStatus: "no_action",
    });
    expect(executionMock).not.toHaveBeenCalled();
    expectNoGameplayWrites(db);
  });

  it("claims an active decision before executing one opinion-driven vote", async () => {
    const db = setup({
      mode: "active",
      alignments: [alignment("FR", 100, 0), alignment("RU", 0, 100)],
      memberships: [membership("FR")],
      pendingMemberships: [pendingMembership("RU")],
    });

    const result = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 16, now);

    expect(result).toMatchObject({ mode: "active", acted: true, decisionRecorded: true });
    expect(result.choice).toMatchObject({ type: "vote_org_no", pendingKind: "membership" });
    expect(executionMock).toHaveBeenCalledWith(
      expect.anything(),
      "FR",
      expect.objectContaining({ _id: headId }),
      expect.objectContaining({ type: "vote_org_no" }),
      16,
      now
    );
    const auditWrites = db.collection("nppForeignPolicyDecisions").updateOne.mock.calls;
    expect(auditWrites[0][1].$setOnInsert).toMatchObject({
      executionStatus: "claimed",
      acted: false,
    });
    expect(auditWrites[1][1].$set).toMatchObject({
      executionStatus: "executed",
      acted: true,
      executionNote: "Executed test choice.",
    });
  });

  it("keeps active trade actions behind the trade rollout stage", async () => {
    const common = {
      mode: "active" as const,
      alignments: [alignment("FR", 100, 0), alignment("RU", 0, 100)],
    };
    const votesDb = setup({ ...common, stage: "votes" });
    const tradeDb = setup({ ...common, stage: "trade" });

    await processAutonomousForeignPolicy(votesDb as unknown as Db, "FR", 18, now);
    const tradeResult = await processAutonomousForeignPolicy(
      tradeDb as unknown as Db,
      "FR",
      18,
      now
    );

    expect(recordedDecision(votesDb).selected).toBeNull();
    expect(recordedDecision(votesDb)).toMatchObject({ stage: "votes" });
    expect(tradeResult.choice).toMatchObject({ type: "raise_tariff" });
    expect(firstRecordedDecision(tradeDb)).toMatchObject({ stage: "trade" });
  });

  it("does not execute an active decision twice after a same-turn restart", async () => {
    const db = setup({
      mode: "active",
      alignments: [alignment("FR", 100, 0), alignment("RU", 0, 100)],
      memberships: [membership("FR")],
      pendingMemberships: [pendingMembership("RU")],
    });
    db.collection("nppForeignPolicyDecisions")
      .updateOne.mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0, upsertedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0 })
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 0, upsertedCount: 0 });

    const first = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 17, now);
    const replay = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 17, now);

    expect(first.acted).toBe(true);
    expect(replay).toMatchObject({ acted: false, decisionRecorded: false });
    expect(executionMock).toHaveBeenCalledTimes(1);
  });
});

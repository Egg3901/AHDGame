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
  pendingLegislation?: Array<Record<string, unknown>>;
  embargoes?: Array<Record<string, unknown>>;
  bills?: Array<Record<string, unknown>>;
  tradeSnapshot?: Record<string, unknown> | null;
  recentDecisions?: Array<Record<string, unknown>>;
  militaryUnits?: Array<Record<string, unknown>>;
  approvalRating?: number;
  /**
   * `nppOffensiveInitiationEnabled`. Off by default, mirroring an unconfigured world:
   * a belligerent is offered `conduct_war` only once an admin has switched it on.
   */
  offensiveInitiation?: boolean;
}

interface RecordedDecision {
  selected: ForeignPolicyChoice | null;
  alternatives: ForeignPolicyChoice[];
  /** Ballots are cast alongside `selected`, not instead of it (#1257). */
  ballots: ForeignPolicyChoice[];
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
    nppOffensiveInitiationEnabled: fixture.offensiveInitiation ?? false,
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
  setFindRows(db, "organizationLegislation", fixture.pendingLegislation ?? []);
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

/**
 * An aid package: a MAJORITY ballot, which is what an autonomous government
 * actually votes on.
 *
 * These tests used a membership proposal until ticket #1257 established that an
 * admission is decided by the player-enabled members alone — and the planner
 * only ever runs for countries that are not player-enabled, so it no longer
 * casts a ballot it could never have counted. Aid keeps what the tests are
 * really about: the vote follows the country's opinion of the subject.
 */
function pendingAid(recipient: "IT" | "RU") {
  return {
    _id: new ObjectId(),
    organizationId: "NATO",
    type: "aid_package",
    aidRecipientCountryId: recipient,
    parties: [],
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
      pendingLegislation: [pendingAid("IT")],
    });

    const result = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 10, now);

    expect(result).toMatchObject({
      ran: true,
      mode: "shadow",
      acted: false,
      decisionRecorded: true,
    });
    // The vote is a BALLOT, not the country's one strategic action — it no
    // longer has to out-rank a tariff to be cast (#1257).
    expect(recordedDecision(db).ballots[0]).toMatchObject({
      type: "vote_org_yes",
      targetCountryId: "IT",
    });
    expect(recordedDecision(db).ballots[0].reasons.join(" ")).toContain("share the US sphere");
    expectNoGameplayWrites(db);
  });

  it("votes no on a hostile application instead of approving every proposal", async () => {
    const db = setup({
      alignments: [alignment("FR", 100, 0), alignment("RU", 0, 100)],
      memberships: [membership("FR")],
      pendingLegislation: [pendingAid("RU")],
    });

    await processAutonomousForeignPolicy(db as unknown as Db, "FR", 11, now);

    expect(recordedDecision(db).ballots[0]).toMatchObject({
      type: "vote_org_no",
      targetCountryId: "RU",
    });
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
      offensiveInitiation: true,
    });
    // `seek_peace` is not behind the switch: leaving a war it cannot sustain is not
    // an offensive, so the exhausted case is deliberately left with it off.
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

  it("conducts the war instead of routine diplomacy once it is the belligerent (ticket #1233)", async () => {
    // The live failure shape: an autonomous belligerent with ready deployed
    // forces spent every strategic slot on tariffs and embargoes against the
    // enemy because `conduct_war`'s old base (25) sat below the routine
    // 46-73 band, and only the top-ranked choice acts. Production recorded
    // zero conduct_war selections while six NATO members sat deployed in an
    // active war, so allies never appeared among a battle's attackers.
    const db = setup({
      alignments: [alignment("FR", 100, 0), alignment("RU", 0, 100)],
      conflicts: [
        {
          _id: "war-for-germany",
          name: "The War for Germany",
          status: "active",
          sideA: { label: "West", countries: ["FR", "US"] },
          sideB: { label: "East", countries: ["RU"] },
        },
      ],
      militaryUnits: [
        {
          _id: new ObjectId(),
          countryId: "FR",
          readiness: 72,
          personnel: 10_000,
          theaterId: "war-for-germany",
          basePower: 100,
        },
      ],
      approvalRating: 60,
      offensiveInitiation: true,
    });

    const result = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 43, now);

    expect(result.choice).toMatchObject({ type: "conduct_war", conflictId: "war-for-germany" });
    const conductWar = recordedDecision(db).alternatives.find(
      (choice) => choice.type === "conduct_war"
    );
    const routine = recordedDecision(db)
      .alternatives.filter(
        (choice) => choice.type !== "conduct_war" && choice.type !== "seek_peace"
      )
      .map((choice) => choice.score);
    expect(conductWar?.score).toBeGreaterThan(Math.max(...routine));
    expectNoGameplayWrites(db);
  });

  it("withholds conduct_war entirely while the admin switch is off", async () => {
    // The switch's whole contract, and the default an unconfigured world gets. It is
    // suppressed at candidate generation rather than refused at execution: NPP
    // countries have no Generals or military technology behind an attack yet, and a
    // refusal would still burn the government's one action for the slot. Same fixture
    // as the #1233 case above with the switch left off, so the switch is the only
    // difference between offering the attack and never mentioning it.
    const db = setup({
      alignments: [alignment("FR", 100, 0), alignment("RU", 0, 100)],
      conflicts: [
        {
          _id: "war-for-germany",
          name: "The War for Germany",
          status: "active",
          sideA: { label: "West", countries: ["FR", "US"] },
          sideB: { label: "East", countries: ["RU"] },
        },
      ],
      militaryUnits: [
        {
          _id: new ObjectId(),
          countryId: "FR",
          readiness: 72,
          personnel: 10_000,
          theaterId: "war-for-germany",
          basePower: 100,
        },
      ],
      approvalRating: 60,
    });

    const result = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 43, now);

    expect(result.choice?.type).not.toBe("conduct_war");
    expect(recordedDecision(db).alternatives.map((choice) => choice.type)).not.toContain(
      "conduct_war"
    );
    expectNoGameplayWrites(db);
  });

  it("seeks peace instead of routine diplomacy once the war exhausts the government", async () => {
    // seek_peace carried the same starvation: its old base (38) lost the slot
    // to hostile tariffs and embargoes, so an exhausted autonomous belligerent
    // kept filing trade actions while its army burned.
    const db = setup({
      alignments: [alignment("FR", 100, 0), alignment("RU", 0, 100)],
      conflicts: [
        {
          _id: "war-for-germany",
          name: "The War for Germany",
          status: "active",
          sideA: { label: "West", countries: ["FR", "US"] },
          sideB: { label: "East", countries: ["RU"] },
        },
      ],
      militaryUnits: [
        {
          _id: new ObjectId(),
          countryId: "FR",
          readiness: 25,
          personnel: 10_000,
          theaterId: "war-for-germany",
          basePower: 100,
        },
      ],
      approvalRating: 15,
    });

    const result = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 44, now);

    expect(result.choice).toMatchObject({
      type: "seek_peace",
      conflictId: "war-for-germany",
      targetCountryId: "RU",
    });
    const seekPeace = recordedDecision(db).alternatives.find(
      (choice) => choice.type === "seek_peace"
    );
    const routine = recordedDecision(db)
      .alternatives.filter(
        (choice) => choice.type !== "conduct_war" && choice.type !== "seek_peace"
      )
      .map((choice) => choice.score);
    expect(seekPeace?.score).toBeGreaterThan(Math.max(...routine));
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
      pendingLegislation: [pendingAid("RU")],
    });

    const result = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 16, now);

    // Nothing here but the ballot, so there is no strategic action to select —
    // and the ballot is cast anyway, which is the point of #1257.
    expect(result).toMatchObject({ mode: "active", decisionRecorded: true, ballotsCast: 1 });
    expect(firstRecordedDecision(db).ballots[0]).toMatchObject({
      type: "vote_org_no",
      pendingKind: "legislation",
    });
    expect(executionMock).toHaveBeenCalledWith(
      expect.anything(),
      "FR",
      expect.objectContaining({ _id: headId }),
      expect.objectContaining({ type: "vote_org_no" }),
      16,
      now
    );
    const auditWrites = db.collection("nppForeignPolicyDecisions").updateOne.mock.calls;
    // Still claim-before-act: the row is written before any ballot is cast.
    expect(auditWrites[0][1].$setOnInsert).toMatchObject({ acted: false });
    expect(auditWrites.at(-1)?.[1].$set).toMatchObject({ ballotsCast: 1 });
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

  it("casts a ballot in the same turn as a higher-scoring strategic action", async () => {
    // THE DISCRIMINATING CASE for ticket #1257.
    //
    // A hostile Russia makes tariffs and embargoes available, and those outscore
    // an organisation vote. A country plans once every six turns and executes one
    // ranked choice, so while ballots competed for that slot the vote simply lost
    // — four contested chances across a 24-turn ballot, and Poland and
    // Czechoslovakia spent every one of theirs elsewhere. Under unanimity that is
    // a permanent veto: China closed 5-of-7 and North Korea 2-of-7 in the Warsaw
    // Pact with not one "no" cast against either.
    //
    // Voting is not a strategic expenditure, so both must happen this turn.
    //
    // The aid names Italy, not Russia, deliberately: an aid package to Russia
    // would soften France's opinion of it and disarm the very tariffs and
    // embargoes this test needs the ballot to be competing against.
    const db = setup({
      mode: "active",
      stage: "war",
      alignments: [alignment("FR", 100, 0), alignment("RU", 0, 100)],
      memberships: [membership("FR")],
      pendingLegislation: [pendingAid("IT")],
    });

    const result = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 19, now);

    expect(result.ballotsCast).toBe(1);
    expect(result.choice).not.toBeNull();
    expect(result.choice?.type).not.toBe("vote_org_no");
    expect(result.choice?.type).not.toBe("vote_org_yes");
    // The ballot was cast even though it never won the action slot.
    expect(executionMock).toHaveBeenCalledWith(
      expect.anything(),
      "FR",
      expect.anything(),
      expect.objectContaining({ type: "vote_org_yes", pendingKind: "legislation" }),
      19,
      now
    );
    expect(executionMock).toHaveBeenCalledWith(
      expect.anything(),
      "FR",
      expect.anything(),
      expect.objectContaining({ type: result.choice!.type }),
      19,
      now
    );
  });

  it("does not cast a ballot on an admission, whose roll it can never be on", async () => {
    // Ticket #1257. An admission is decided by the player-enabled members alone,
    // and the planner only ever runs for a country that is NOT player-enabled
    // (isNppAutonomyActive is defined that way). So this ballot could never have
    // been counted; writing it only put consent on the proposal for the panels
    // to show beside a tally that ignored it.
    const db = setup({
      mode: "active",
      alignments: [alignment("FR", 100, 0), alignment("IT", 80, 0)],
      memberships: [membership("FR"), membership("IT")],
      pendingMemberships: [
        {
          _id: new ObjectId(),
          organizationId: "NATO",
          proposingCountryId: "IT",
          status: "pending",
          votes: [],
        },
      ],
    });

    const result = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 21, now);

    expect(result.ballotsCast).toBe(0);
    expect(executionMock).not.toHaveBeenCalledWith(
      expect.anything(),
      "FR",
      expect.anything(),
      expect.objectContaining({ pendingKind: "membership" }),
      expect.anything(),
      expect.anything()
    );
  });

  it("does not execute an active decision twice after a same-turn restart", async () => {
    const db = setup({
      mode: "active",
      alignments: [alignment("FR", 100, 0), alignment("RU", 0, 100)],
      memberships: [membership("FR")],
      pendingLegislation: [pendingAid("RU")],
    });
    db.collection("nppForeignPolicyDecisions")
      .updateOne.mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0, upsertedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0 })
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 0, upsertedCount: 0 });

    const first = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 17, now);
    const replay = await processAutonomousForeignPolicy(db as unknown as Db, "FR", 17, now);

    // Ballots are cast off the action budget now, so the restart guard has to
    // hold for them too: `decisionRecorded` gates the ballot loop exactly as it
    // gates the strategic action, or a replayed turn would vote twice.
    expect(first).toMatchObject({ ballotsCast: 1 });
    expect(replay).toMatchObject({ acted: false, decisionRecorded: false, ballotsCast: 0 });
    expect(executionMock).toHaveBeenCalledTimes(1);
  });
});

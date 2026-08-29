import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { NPP } from "@/lib/db/types";
import { createMockDb } from "@/lib/test-utils/mockDb";

const { autonomyMock, recomputeMock } = vi.hoisted(() => ({
  autonomyMock: vi.fn(),
  recomputeMock: vi.fn(),
}));

vi.mock("../featureFlag", () => ({
  isNppAutonomyActive: (...args: unknown[]) => autonomyMock(...args),
}));

vi.mock("@/lib/country/recomputeNationalApproval", () => ({
  recomputeNationalApproval: (...args: unknown[]) => recomputeMock(...args),
}));

import {
  executeAutonomousWarChoice,
  planAutonomousDeployment,
  prepareAutonomousWarEntry,
} from "../autonomousWarCommands";

const head = { _id: new ObjectId(), name: "Autonomous Premier" } as NPP;
const conflict = {
  _id: "korea",
  name: "Korean War",
  status: "active",
  sideA: { label: "UN Coalition", countries: ["FR", "US"], kind: "coalition" },
  sideB: { label: "Communist Coalition", countries: ["RU"], kind: "coalition" },
} as ConflictDoc;

function unit(basePower: number, readiness = 70): MilitaryUnit {
  return {
    _id: new ObjectId(),
    countryId: "FR",
    basePower,
    readiness,
    personnel: 10_000,
    theaterId: "reserve",
    posture: "standard",
  } as MilitaryUnit;
}

beforeEach(() => {
  autonomyMock.mockReset().mockResolvedValue(true);
  recomputeMock.mockReset().mockResolvedValue(50);
});

describe("autonomous war commands", () => {
  it("plans a bounded deterministic reserve commitment", () => {
    const units = [unit(10), unit(20), unit(70)];

    const selected = planAutonomousDeployment(units);

    expect(selected.map((row) => row.basePower)).toEqual([10, 20]);
  });

  it("commits more depth through the Warsaw Pact unified command", () => {
    const units = [unit(10), unit(20), unit(30), unit(40)];

    const selected = planAutonomousDeployment(units, 0.35, "highest");

    expect(selected.map((row) => row.basePower)).toEqual([40]);
  });

  it("rechecks policy, approval, debt, and forces before ratified NPP war entry", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      nppForeignPolicyMode: "active",
      nppForeignPolicyStage: "war",
    });
    db.collection("governmentApprovals").findOne.mockResolvedValue({ approvalRating: 60 });
    db.collection("federalBudget").findOne.mockResolvedValue({ debtToGdpRatio: 50 });
    db.collection("militaryUnits")
      .find()
      .toArray.mockResolvedValue([unit(10), unit(20), unit(70)]);
    db.collection("militaryUnits").updateMany.mockResolvedValue({ modifiedCount: 2 });

    const result = await prepareAutonomousWarEntry(db as unknown as Db, "FR", conflict, 50);

    expect(result).toMatchObject({ ready: true, deployedUnits: 2 });
    expect(db.collection("militaryUnits").updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "FR", theaterId: "reserve" }),
      { $set: { theaterId: "korea", posture: "standard" } }
    );
  });

  it("halts ratified NPP entry when public approval has collapsed", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      nppForeignPolicyMode: "active",
      nppForeignPolicyStage: "war",
    });
    db.collection("governmentApprovals").findOne.mockResolvedValue({ approvalRating: 30 });
    db.collection("federalBudget").findOne.mockResolvedValue({ debtToGdpRatio: 50 });

    const result = await prepareAutonomousWarEntry(db as unknown as Db, "FR", conflict, 50);

    expect(result).toMatchObject({ ready: false, deployedUnits: 0 });
    expect(db.collection("militaryUnits").updateMany).not.toHaveBeenCalled();
  });

  it("measures approval when the country has no stored document", async () => {
    // A country that is neither `active` nor already a belligerent never gets a
    // governmentApprovals document, so reading a missing one as zero refused every
    // such entry outright -- the exact case the national bill route exists to serve.
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      nppForeignPolicyMode: "active",
      nppForeignPolicyStage: "war",
    });
    db.collection("governmentApprovals").findOne.mockResolvedValue(null);
    db.collection("federalBudget").findOne.mockResolvedValue({ debtToGdpRatio: 50 });
    db.collection("militaryUnits")
      .find()
      .toArray.mockResolvedValue([unit(10), unit(20), unit(70)]);
    db.collection("militaryUnits").updateMany.mockResolvedValue({ modifiedCount: 2 });
    recomputeMock.mockResolvedValue(49.5);

    const result = await prepareAutonomousWarEntry(db as unknown as Db, "FR", conflict, 50);

    expect(result).toMatchObject({ ready: true, deployedUnits: 2 });
  });

  it("halts entry when the measured approval is below the floor", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      nppForeignPolicyMode: "active",
      nppForeignPolicyStage: "war",
    });
    db.collection("governmentApprovals").findOne.mockResolvedValue(null);
    db.collection("federalBudget").findOne.mockResolvedValue({ debtToGdpRatio: 50 });
    recomputeMock.mockResolvedValue(30);

    const result = await prepareAutonomousWarEntry(db as unknown as Db, "FR", conflict, 50);

    expect(result).toMatchObject({ ready: false, deployedUnits: 0 });
    expect(db.collection("militaryUnits").updateMany).not.toHaveBeenCalled();
  });

  it("prefers the stored rating over a recompute", async () => {
    // The snapshot carries the national providers -- war block, address bump, org
    // statements, cabinet -- that the live recompute deliberately omits. Where one
    // exists it is the better number, so it must win.
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      nppForeignPolicyMode: "active",
      nppForeignPolicyStage: "war",
    });
    db.collection("governmentApprovals").findOne.mockResolvedValue({ approvalRating: 30 });
    db.collection("federalBudget").findOne.mockResolvedValue({ debtToGdpRatio: 50 });
    recomputeMock.mockResolvedValue(90);

    const result = await prepareAutonomousWarEntry(db as unknown as Db, "FR", conflict, 50);

    expect(result).toMatchObject({ ready: false, deployedUnits: 0 });
  });

  it("halts ratified NPP entry when the rollout has returned to votes", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({ _id: "current" });

    const result = await prepareAutonomousWarEntry(db as unknown as Db, "FR", conflict, 50);

    expect(result).toMatchObject({ ready: false, deployedUnits: 0 });
    expect(db.collection("governmentApprovals").findOne).not.toHaveBeenCalled();
  });

  it("queues an offensive through the normal battle declaration collection", async () => {
    const db = createMockDb();
    db.collection("conflicts").findOne.mockResolvedValue(conflict);
    db.collection("battleDeclarations").findOne.mockResolvedValue(null);
    db.collection("militaryUnits").countDocuments.mockResolvedValue(2);

    const result = await executeAutonomousWarChoice(
      db as unknown as Db,
      "FR",
      head,
      { type: "conduct_war", score: 50, conflictId: "korea", reasons: [] },
      51
    );

    expect(result.acted).toBe(true);
    expect(db.collection("battleDeclarations").insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        declarerCountry: "FR",
        targetCountry: "RU",
        theaterId: "korea",
        declaredTurn: 51,
        status: "pending",
      })
    );
  });

  it("opens a white-peace offer when war pressure is unsustainable", async () => {
    const db = createMockDb();
    db.collection("conflicts").findOne.mockResolvedValue(conflict);
    db.collection("peaceOffers").find().toArray.mockResolvedValue([]);

    const result = await executeAutonomousWarChoice(
      db as unknown as Db,
      "FR",
      head,
      {
        type: "seek_peace",
        score: 60,
        conflictId: "korea",
        targetCountryId: "RU",
        reasons: [],
      },
      52
    );

    expect(result.acted).toBe(true);
    expect(db.collection("peaceOffers").insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        fromCountry: "FR",
        toCountry: "RU",
        term: { kind: "white_peace" },
        offeredTurn: 52,
        expiresTurn: 124,
        status: "pending",
      })
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { BargainingCampaign, Character, Union } from "@/lib/db/types";
import { STRIKE_EXPECTATION_GAP_THRESHOLD } from "@/lib/labour/strikes";
import { realWageIndex } from "@/lib/labour/unionization";
import {
  actOnBargainingCampaignAsEmployer,
  actOnBargainingCampaignAsUnion,
  bargainingMacroInputs,
  proposeBargainingCampaign,
} from "./bargaining";
import { laborTightnessFromUnemployment } from "@/lib/unions/bargaining";

vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi
    .fn()
    .mockImplementation(async (_inside: unknown, fallback: () => Promise<void>) => fallback()),
}));

function character(id = new ObjectId()): Character {
  return { _id: id, name: "Organizer" } as unknown as Character;
}

function union(ownerId: ObjectId): Union {
  return {
    _id: new ObjectId(),
    countryId: "US",
    sectorType: "manufacturing",
    name: "Industrial Workers",
    ownerId,
    treasury: 2400,
    membershipPressure: 60,
    lastCalledStrikeTurn: null,
    demandedWageLevel: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function disputedCampaign(args: {
  unionId: ObjectId;
  employerId: ObjectId;
  sectorId: ObjectId;
  escalationLevel?: BargainingCampaign["escalationLevel"];
  mediation?: BargainingCampaign["mediation"];
}): BargainingCampaign {
  const offer = {
    revision: 2,
    proposedBy: "employer" as const,
    wageLevel: 1.08,
    agreementDurationTurns: 48,
    noStrikeTurns: 24,
    proposedAtTurn: 101,
    proposedAt: new Date(),
  };
  return {
    _id: new ObjectId(),
    unionId: args.unionId,
    countryId: "US",
    sectorType: "manufacturing",
    employerCorporationId: args.employerId,
    sectorIds: [args.sectorId],
    status: "dispute",
    escalationLevel: args.escalationLevel ?? "none",
    mandate: {
      coverage: 70,
      grievance: 50,
      laborTightness: 70,
      lawSupport: 60,
      strikeFundRunway: 4,
      support: 70,
      leverage: 60,
      organizedLocalCount: 1,
      totalLocalCount: 1,
    },
    currentOffer: offer,
    offers: [
      {
        ...offer,
        revision: 1,
        proposedBy: "union",
        wageLevel: 1.15,
        proposedAtTurn: 100,
      },
      offer,
    ],
    startedAtTurn: 100,
    deadlineTurn: 108,
    lastActionTurn: 101,
    disputeStartedAtTurn: 101,
    mediation: args.mediation,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("bargaining commands", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens an employer-scoped campaign from server-derived local and macro conditions", async () => {
    const leader = character();
    const ledUnion = union(leader._id);
    const employerId = new ObjectId();
    const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    const db = {
      collection: (name: string) => {
        if (name === "gameState")
          return { findOne: vi.fn().mockResolvedValue({ isProcessing: false }) };
        if (name === "unions") return { findOne: vi.fn().mockResolvedValue(ledUnion) };
        if (name === "federalBudget")
          return { findOne: vi.fn().mockResolvedValue({ unionsBanned: false, unionLawBias: 10 }) };
        if (name === "macroMetrics")
          return {
            findOne: vi.fn().mockResolvedValue({ economic: { unemploymentRate: { value: 4 } } }),
            find: () => ({
              toArray: () =>
                Promise.resolve([{ _id: "NY", economic: { costOfLiving: { value: 100 } } }]),
            }),
          };
        if (name === "corporations")
          return { findOne: vi.fn().mockResolvedValue({ _id: employerId }) };
        if (name === "corporateSectors")
          return {
            find: () => ({
              toArray: () =>
                Promise.resolve([
                  {
                    _id: new ObjectId(),
                    stateId: "NY",
                    workers: 1000,
                    unionization: 60,
                    wageLevel: 1,
                  },
                ]),
            }),
          };
        if (name === "collectiveAgreements") return { findOne: vi.fn().mockResolvedValue(null) };
        if (name === "bargainingCampaigns")
          return { insertOne, findOne: vi.fn().mockResolvedValue(null) };
        if (name === "states") return { find: () => ({ toArray: () => Promise.resolve([]) }) };
        if (name === "gameConfig")
          return { findOne: vi.fn().mockResolvedValue({ labourSystemMode: "full" }) };
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;

    const result = await proposeBargainingCampaign(
      db,
      leader,
      ledUnion._id.toString(),
      employerId.toString(),
      { wageLevel: 1.15, agreementDurationTurns: 48, noStrikeTurns: 24 },
      100
    );

    expect(result.ok).toBe(true);
    const inserted = insertOne.mock.calls[0][0] as BargainingCampaign;
    expect(inserted.employerCorporationId).toEqual(employerId);
    expect(inserted.sectorIds).toHaveLength(1);
    expect(inserted.mandate.coverage).toBe(60);
    expect(inserted.mandate.laborTightness).toBeGreaterThan(80);
    expect(inserted.deadlineTurn).toBe(108);
  });

  it("lets the employer accept the union's offer and records the agreement on fallback Mongo", async () => {
    const userId = new ObjectId();
    const employerId = new ObjectId();
    const sectorId = new ObjectId();
    const campaign: BargainingCampaign = {
      _id: new ObjectId(),
      unionId: new ObjectId(),
      countryId: "US",
      sectorType: "manufacturing",
      employerCorporationId: employerId,
      sectorIds: [sectorId],
      status: "negotiating",
      escalationLevel: "none",
      mandate: {
        coverage: 60,
        grievance: 50,
        laborTightness: 70,
        lawSupport: 50,
        strikeFundRunway: 4,
        support: 56,
        leverage: 58,
        organizedLocalCount: 1,
        totalLocalCount: 1,
      },
      currentOffer: {
        revision: 1,
        proposedBy: "union",
        wageLevel: 1.15,
        agreementDurationTurns: 48,
        noStrikeTurns: 24,
        proposedAtTurn: 100,
        proposedAt: new Date(),
      },
      offers: [],
      startedAtTurn: 100,
      deadlineTurn: 108,
      lastActionTurn: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    campaign.offers = [campaign.currentOffer];
    const campaignUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const agreementInsert = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    const wageUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const db = {
      collection: (name: string) => {
        if (name === "gameState")
          return { findOne: vi.fn().mockResolvedValue({ isProcessing: false }) };
        if (name === "bargainingCampaigns") {
          return { findOne: vi.fn().mockResolvedValue(campaign), updateOne: campaignUpdate };
        }
        if (name === "corporations") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: employerId,
              userId,
              ceoVacant: false,
            }),
          };
        }
        if (name === "collectiveAgreements") {
          return {
            insertOne: agreementInsert,
            deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
          };
        }
        if (name === "corporateSectors") return { updateMany: wageUpdate };
        if (name === "states") return { find: () => ({ toArray: () => Promise.resolve([]) }) };
        if (name === "gameConfig")
          return { findOne: vi.fn().mockResolvedValue({ labourSystemMode: "full" }) };
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;

    const result = await actOnBargainingCampaignAsEmployer(
      db,
      userId.toString(),
      employerId.toString(),
      campaign._id.toString(),
      "accept",
      102
    );

    expect(result.ok).toBe(true);
    expect(agreementInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: campaign._id,
        wageLevel: 1.15,
        expiresAtTurn: 150,
        noStrikeUntilTurn: 126,
      }),
      { session: undefined }
    );
    expect(wageUpdate).not.toHaveBeenCalled();
  });

  it("does not let a union route act on another union's campaign", async () => {
    const leader = character();
    const ledUnion = union(leader._id);
    const campaign = {
      _id: new ObjectId(),
      unionId: ledUnion._id,
    } as BargainingCampaign;
    const unionLookup = vi.fn();
    const db = {
      collection: (name: string) => {
        if (name === "gameState")
          return { findOne: vi.fn().mockResolvedValue({ isProcessing: false }) };
        if (name === "bargainingCampaigns") {
          return { findOne: vi.fn().mockResolvedValue(campaign) };
        }
        if (name === "unions") return { findOne: unionLookup };
        if (name === "states") return { find: () => ({ toArray: () => Promise.resolve([]) }) };
        if (name === "gameConfig")
          return { findOne: vi.fn().mockResolvedValue({ labourSystemMode: "full" }) };
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;

    const result = await actOnBargainingCampaignAsUnion(
      db,
      leader,
      new ObjectId().toString(),
      campaign._id.toString(),
      "withdraw",
      102
    );

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "Bargaining campaign not found for this union.",
    });
    expect(unionLookup).not.toHaveBeenCalled();
  });

  it("charges the strike fund and starts scoped locals for selective escalation", async () => {
    const leader = character();
    const ledUnion = union(leader._id);
    const employerId = new ObjectId();
    const sectorId = new ObjectId();
    const campaign = disputedCampaign({
      unionId: ledUnion._id,
      employerId,
      sectorId,
      escalationLevel: "overtime_ban",
    });
    const campaignUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const unionUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const sectorBulkWrite = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = {
      collection: (name: string) => {
        if (name === "gameState")
          return { findOne: vi.fn().mockResolvedValue({ isProcessing: false }) };
        if (name === "bargainingCampaigns") {
          return { findOne: vi.fn().mockResolvedValue(campaign), updateOne: campaignUpdate };
        }
        if (name === "unions") {
          return { findOne: vi.fn().mockResolvedValue(ledUnion), updateOne: unionUpdate };
        }
        if (name === "federalBudget") {
          return { findOne: vi.fn().mockResolvedValue({ unionsBanned: false }) };
        }
        if (name === "macroMetrics") {
          return {
            findOne: vi.fn().mockResolvedValue({ economic: { unemploymentRate: { value: 5 } } }),
            find: () => ({
              toArray: () =>
                Promise.resolve([{ _id: "NY", economic: { costOfLiving: { value: 110 } } }]),
            }),
          };
        }
        if (name === "corporateSectors") {
          return {
            find: () => ({
              toArray: () =>
                Promise.resolve([
                  {
                    _id: sectorId,
                    stateId: "NY",
                    workers: 1000,
                    workerExpectationIndex: 1.2,
                    wageLevel: 1,
                    unionization: 70,
                    strikeStartedAtTurn: null,
                    strikeCooldownUntilTurn: null,
                  },
                ]),
            }),
            bulkWrite: sectorBulkWrite,
          };
        }
        if (name === "states") return { find: () => ({ toArray: () => Promise.resolve([]) }) };
        if (name === "gameConfig")
          return { findOne: vi.fn().mockResolvedValue({ labourSystemMode: "full" }) };
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;

    const result = await actOnBargainingCampaignAsUnion(
      db,
      leader,
      ledUnion._id.toString(),
      campaign._id.toString(),
      "escalate",
      102
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        escalationLevel: "selective_strike",
        sectorsStriking: 1,
        cashSpent: 400,
      })
    );
    expect(unionUpdate).toHaveBeenCalledWith(
      { _id: ledUnion._id, treasury: { $gte: 400 } },
      expect.objectContaining({ $inc: { treasury: -400 } }),
      { session: undefined }
    );
    expect(sectorBulkWrite).toHaveBeenCalledOnce();
    const strikeOps = sectorBulkWrite.mock.calls[0][0] as Array<{
      updateOne: {
        filter: { strikeStartedAtTurn: number | null };
        update: { $set: { workerExpectationIndex: number } };
      };
    }>;
    expect(strikeOps[0].updateOne.filter.strikeStartedAtTurn).toBeNull();
    // Cost of living in the local's state, not a neutral 100: a COL-blind
    // figure sits below the concession threshold the moment the corporation
    // turn recomputes the gap, and resolves the strike immediately.
    expect(strikeOps[0].updateOne.update.$set.workerExpectationIndex).toBeCloseTo(
      realWageIndex(1, 110) + STRIKE_EXPECTATION_GAP_THRESHOLD + 0.05,
      6
    );
    expect(strikeOps[0].updateOne.update.$set.workerExpectationIndex).not.toBe(2);
  });

  it("lets an employer request a server-derived mediation package in dispute", async () => {
    const userId = new ObjectId();
    const employerId = new ObjectId();
    const campaign = disputedCampaign({
      unionId: new ObjectId(),
      employerId,
      sectorId: new ObjectId(),
    });
    const campaignUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const db = {
      collection: (name: string) => {
        if (name === "gameState") {
          return { findOne: vi.fn().mockResolvedValue({ isProcessing: false }) };
        }
        if (name === "bargainingCampaigns") {
          return { findOne: vi.fn().mockResolvedValue(campaign), updateOne: campaignUpdate };
        }
        if (name === "corporations") {
          return {
            findOne: vi.fn().mockResolvedValue({ userId, ceoVacant: false }),
          };
        }
        if (name === "states") return { find: () => ({ toArray: () => Promise.resolve([]) }) };
        if (name === "gameConfig")
          return { findOne: vi.fn().mockResolvedValue({ labourSystemMode: "full" }) };
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;

    const result = await actOnBargainingCampaignAsEmployer(
      db,
      userId.toString(),
      employerId.toString(),
      campaign._id.toString(),
      "request_mediation",
      103
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        mediation: expect.objectContaining({
          employerAccepted: true,
          unionAccepted: false,
          status: "pending",
        }),
      })
    );
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ mediation: { $exists: false } }),
      expect.objectContaining({
        $set: expect.objectContaining({
          mediation: expect.objectContaining({ requestedBy: "employer" }),
        }),
      })
    );
  });

  it("holds the union-level strike cooldown that the retired direct-strike route enforced", () => {
    const leader = character();
    const ledUnion = { ...union(leader._id), lastCalledStrikeTurn: 100 };
    const sectorId = new ObjectId();
    const campaign = disputedCampaign({
      unionId: ledUnion._id,
      employerId: new ObjectId(),
      sectorId,
      escalationLevel: "overtime_ban",
    });
    const sectorBulkWrite = vi.fn();
    const db = {
      collection: (name: string) => {
        if (name === "gameState")
          return { findOne: vi.fn().mockResolvedValue({ isProcessing: false }) };
        if (name === "bargainingCampaigns")
          return { findOne: vi.fn().mockResolvedValue(campaign), updateOne: vi.fn() };
        if (name === "unions")
          return { findOne: vi.fn().mockResolvedValue(ledUnion), updateOne: vi.fn() };
        if (name === "federalBudget") return { findOne: vi.fn().mockResolvedValue({}) };
        if (name === "macroMetrics")
          return {
            findOne: vi.fn().mockResolvedValue({ economic: { unemploymentRate: { value: 5 } } }),
            find: () => ({
              toArray: () =>
                Promise.resolve([{ _id: "NY", economic: { costOfLiving: { value: 100 } } }]),
            }),
          };
        if (name === "corporateSectors")
          return {
            find: () => ({
              toArray: () =>
                Promise.resolve([
                  {
                    _id: sectorId,
                    stateId: "NY",
                    workers: 1000,
                    workerExpectationIndex: 1.2,
                    wageLevel: 1,
                    unionization: 70,
                    strikeStartedAtTurn: null,
                    strikeCooldownUntilTurn: null,
                  },
                ]),
            }),
            bulkWrite: sectorBulkWrite,
          };
        if (name === "states") return { find: () => ({ toArray: () => Promise.resolve([]) }) };
        if (name === "gameConfig")
          return { findOne: vi.fn().mockResolvedValue({ labourSystemMode: "full" }) };
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;

    return actOnBargainingCampaignAsUnion(
      db,
      leader,
      ledUnion._id.toString(),
      campaign._id.toString(),
      "escalate",
      104
    ).then((result) => {
      expect(result).toEqual({
        ok: false,
        status: 409,
        error: "This union can call another strike on turn 108.",
      });
      expect(sectorBulkWrite).not.toHaveBeenCalled();
    });
  });

  it("makes a union wait out the cooling-off period before reopening on the same employer", async () => {
    const leader = character();
    const ledUnion = union(leader._id);
    const employerId = new ObjectId();
    const insertOne = vi.fn();
    const db = {
      collection: (name: string) => {
        if (name === "gameState")
          return { findOne: vi.fn().mockResolvedValue({ isProcessing: false }) };
        if (name === "unions") return { findOne: vi.fn().mockResolvedValue(ledUnion) };
        if (name === "federalBudget") return { findOne: vi.fn().mockResolvedValue({}) };
        if (name === "macroMetrics")
          return {
            findOne: vi.fn().mockResolvedValue({ economic: { unemploymentRate: { value: 5 } } }),
            find: () => ({ toArray: () => Promise.resolve([]) }),
          };
        if (name === "corporations")
          return { findOne: vi.fn().mockResolvedValue({ _id: employerId }) };
        if (name === "corporateSectors")
          return {
            find: () => ({
              toArray: () =>
                Promise.resolve([
                  {
                    _id: new ObjectId(),
                    stateId: "NY",
                    workers: 500,
                    unionization: 60,
                    wageLevel: 1,
                  },
                ]),
            }),
          };
        if (name === "collectiveAgreements") return { findOne: vi.fn().mockResolvedValue(null) };
        if (name === "bargainingCampaigns")
          return { insertOne, findOne: vi.fn().mockResolvedValue({ endedAtTurn: 118 }) };
        if (name === "states") return { find: () => ({ toArray: () => Promise.resolve([]) }) };
        if (name === "gameConfig")
          return { findOne: vi.fn().mockResolvedValue({ labourSystemMode: "full" }) };
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;

    const result = await proposeBargainingCampaign(
      db,
      leader,
      ledUnion._id.toString(),
      employerId.toString(),
      { wageLevel: 1.15, agreementDurationTurns: 48, noStrikeTurns: 24 },
      120
    );

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "Bargaining with this employer can reopen on turn 126.",
    });
    expect(insertOne).not.toHaveBeenCalled();
  });
});

describe("bargainingMacroInputs (#791)", () => {
  function macroDb(args: {
    states: Array<{ _id: string }>;
    metricsDocs: unknown[];
    unemployment?: number;
    labourSystemMode?: string | null;
  }) {
    return {
      collection: (name: string) => {
        if (name === "states")
          return { find: () => ({ toArray: () => Promise.resolve(args.states) }) };
        if (name === "macroMetrics")
          return {
            findOne: vi.fn().mockResolvedValue({
              economic: { unemploymentRate: { value: args.unemployment ?? 5 } },
            }),
            find: () => ({ toArray: () => Promise.resolve(args.metricsDocs) }),
          };
        if (name === "federalBudget")
          return { findOne: vi.fn().mockResolvedValue({ unionLawBias: 10 }) };
        if (name === "gameConfig")
          return {
            findOne: vi
              .fn()
              .mockResolvedValue(
                args.labourSystemMode === null
                  ? null
                  : { labourSystemMode: args.labourSystemMode ?? "full" }
              ),
          };
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;
  }

  const doc = (id: string, tightness: number | undefined, laborForce: number | undefined) => ({
    _id: id,
    economic: {
      ...(tightness !== undefined ? { labourTightness: { value: tightness } } : {}),
      ...(laborForce !== undefined ? { laborForce: { value: laborForce } } : {}),
    },
  });

  it("scores the worker-weighted national tightness, not a flat state mean", async () => {
    const db = macroDb({
      states: [{ _id: "BIG" }, { _id: "SMALL" }],
      metricsDocs: [doc("BIG", 1.0, 900), doc("SMALL", 8.0, 100)],
      unemployment: 5,
    });
    const macro = await bargainingMacroInputs(db, "US");
    // Worker-weighted national tightness is 1.7 → 63.3; a flat mean (4.5)
    // would score 87.6. The tiny state's 8x reading must not dominate.
    expect(macro.laborTightness).toBe(63.3);
  });

  it("responds to state tightness directly at fixed unemployment", async () => {
    const world = (tightness: number) =>
      macroDb({
        states: [{ _id: "A" }, { _id: "B" }],
        metricsDocs: [doc("A", tightness, 500), doc("B", tightness, 500)],
        unemployment: 5,
      });
    const tight = await bargainingMacroInputs(world(2), "US");
    const slack = await bargainingMacroInputs(world(0.5), "US");
    // Same 5% unemployment in both worlds, yet opposite scores: the
    // unemployment round-trip is broken.
    expect(tight.laborTightness).toBe(67.3);
    expect(slack.laborTightness).toBe(32.7);
    expect(tight.laborTightness).not.toBe(laborTightnessFromUnemployment(5));
  });

  it("cold start with no measured tightness matches today's behaviour exactly", async () => {
    const empty = await bargainingMacroInputs(
      macroDb({ states: [], metricsDocs: [], unemployment: 4 }),
      "US"
    );
    expect(empty.laborTightness).toBe(laborTightnessFromUnemployment(4));

    const unmeasured = await bargainingMacroInputs(
      macroDb({
        states: [{ _id: "A" }],
        metricsDocs: [doc("A", undefined, 500)],
        unemployment: 4,
      }),
      "US"
    );
    expect(unmeasured.laborTightness).toBe(laborTightnessFromUnemployment(4));
  });

  it("stays on the fallback below the macro tier even when readings exist", async () => {
    // Telemetry is written ungated, so a mode-off world can hold measured
    // readings. Bargaining must still behave exactly as before there, matching
    // the metric engine's gate on the unemployment channel.
    for (const mode of ["off", "wages", null] as const) {
      const macro = await bargainingMacroInputs(
        macroDb({
          states: [{ _id: "A" }, { _id: "B" }],
          metricsDocs: [doc("A", 2, 500), doc("B", 2, 500)],
          unemployment: 5,
          labourSystemMode: mode,
        }),
        "US"
      );
      expect(macro.laborTightness).toBe(laborTightnessFromUnemployment(5));
    }
  });

  it("uses the measured path at the macro tier", async () => {
    const macro = await bargainingMacroInputs(
      macroDb({
        states: [{ _id: "A" }],
        metricsDocs: [doc("A", 2, 500)],
        unemployment: 5,
        labourSystemMode: "macro",
      }),
      "US"
    );
    expect(macro.laborTightness).toBe(67.3);
  });
});

import { beforeEach, describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type {
  BargainingCampaign,
  CollectiveAgreement,
  Corporation,
  CorporateSector,
  Union,
} from "@/lib/db/types";
import type { NPP } from "@/lib/db/types/npp";
import { processNppUnionBehavior } from "./nppUnionBehavior";
import {
  openBargainingCampaignFromLiveConditions,
  persistBargainingCounter,
  persistBargainingSettlement,
  persistUnionBargainingEscalation,
} from "@/lib/unions/commands/bargaining";

vi.mock("@/lib/unions/commands/bargaining", () => ({
  openBargainingCampaignFromLiveConditions: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
  persistBargainingCounter: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
  persistBargainingMediationAction: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
  persistBargainingSettlement: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
  persistUnionBargainingEscalation: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
}));

let nppAutonomyLevel: "off" | "v3" = "v3";
let labourSystemMode: "off" | "full" = "full";

vi.mock("@/lib/nppAutonomy/featureFlag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nppAutonomy/featureFlag")>();
  return {
    ...actual,
    getNppAutonomyLevel: vi.fn().mockImplementation(async () => nppAutonomyLevel),
  };
});

vi.mock("@/lib/labour/featureFlag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/labour/featureFlag")>();
  return {
    ...actual,
    getLabourSystemMode: vi.fn().mockImplementation(async () => labourSystemMode),
  };
});

function makeUnion(countryId: string, overrides: Partial<Union> = {}): Union {
  return {
    _id: new ObjectId(),
    countryId,
    sectorType: "manufacturing",
    name: "Test Union",
    ownerId: null,
    treasury: 0,
    lastCalledStrikeTurn: null,
    demandedWageLevel: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Union;
}

/** A militant NPP: ambition/stubbornness both 80 → militancy 0.8, well past every gate (0.35/0.55). */
function makeMilitantNpp(countryId: string): NPP {
  return {
    _id: new ObjectId(),
    countryId,
    name: "Test NPP",
    homeState: "X",
    personality: { loyalty: 50, ambition: 80, stubbornness: 80 },
    generatedAt: new Date(),
    retiredAt: null,
  } as unknown as NPP;
}

/**
 * Minimal fake `unions`/`npps`/`corporateSectors`/`corporations` collections.
 * `bulkWrite` actually applies $set/$unset back onto the backing arrays, like
 * a real DB would, so multi-call sequencing (election, then demand-clearing)
 * composes the same way it does in production instead of only inspecting the
 * raw ops.
 */
function mockDb({
  unions,
  npps,
  sectors = [],
  corporations = [],
  campaigns = [],
  agreements = [],
}: {
  unions: Union[];
  npps: NPP[];
  sectors?: CorporateSector[];
  corporations?: Corporation[];
  campaigns?: BargainingCampaign[];
  agreements?: CollectiveAgreement[];
}) {
  const unionsBulkWrite = vi.fn().mockImplementation(async (ops: unknown[]) => {
    for (const raw of ops as Array<{
      updateOne: { filter: { _id: ObjectId }; update: Record<string, unknown> };
    }>) {
      const { filter, update } = raw.updateOne;
      const union = unions.find((u) => u._id.equals(filter._id));
      if (!union) continue;
      if (update.$set) Object.assign(union, update.$set);
      if (update.$unset) {
        for (const key of Object.keys(update.$unset as Record<string, unknown>)) {
          (union as unknown as Record<string, unknown>)[key] = undefined;
        }
      }
    }
    return {};
  });
  const unionsUpdateMany = vi.fn().mockResolvedValue({});
  const sectorsFind = vi
    .fn()
    .mockImplementation(() => ({ toArray: () => Promise.resolve(sectors) }));

  const db = {
    collection: (name: string) => {
      if (name === "unions") {
        return {
          find: () => ({ toArray: () => Promise.resolve(unions) }),
          bulkWrite: unionsBulkWrite,
          updateMany: unionsUpdateMany,
        };
      }
      if (name === "npps") {
        // Real query filters by countryId/retiredAt/_id, the backing array here
        // is small and entirely retiredAt: null, so returning it unfiltered is
        // equivalent for what this test exercises (union-side outcomes).
        return { find: () => ({ toArray: () => Promise.resolve(npps) }) };
      }
      if (name === "corporateSectors") {
        return {
          aggregate: () => ({ toArray: () => Promise.resolve([]) }),
          find: sectorsFind,
          bulkWrite: vi.fn().mockResolvedValue({}),
        };
      }
      if (name === "corporations") {
        return { find: () => ({ toArray: () => Promise.resolve(corporations) }) };
      }
      if (name === "bargainingCampaigns") {
        return { find: () => ({ toArray: () => Promise.resolve(campaigns) }) };
      }
      if (name === "collectiveAgreements") {
        return { find: () => ({ toArray: () => Promise.resolve(agreements) }) };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;

  return { db, unionsBulkWrite, unionsUpdateMany, sectorsFind };
}

describe("processNppUnionBehavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(openBargainingCampaignFromLiveConditions).mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.mocked(persistBargainingCounter).mockResolvedValue({ ok: true, status: 200 });
    vi.mocked(persistBargainingSettlement).mockResolvedValue({ ok: true, status: 200 });
    vi.mocked(persistUnionBargainingEscalation).mockResolvedValue({ ok: true, status: 200 });
  });
  it(
    "elects NPP leaders into every vacant union, regression: without this phase every seeded " +
      "union stays permanently vacant (the turn-650 sandbox symptom, pre-dues-v1: 408 unions " +
      "stuck unowned forever with nobody to run them)",
    async () => {
      const unions = [
        makeUnion("PL", { treasury: 1000 }),
        makeUnion("PL", { treasury: 1000 }),
        makeUnion("PL", { treasury: 1000 }),
        makeUnion("HU", { treasury: 1000 }),
        makeUnion("HU", { treasury: 1000 }),
        makeUnion("HU", { treasury: 1000 }),
      ];
      const npps = [
        makeMilitantNpp("PL"),
        makeMilitantNpp("PL"),
        makeMilitantNpp("PL"),
        makeMilitantNpp("HU"),
        makeMilitantNpp("HU"),
        makeMilitantNpp("HU"),
      ];
      const { db } = mockDb({ unions, npps });

      const result = await processNppUnionBehavior(db, 1);

      // Every vacant union got an NPP leader, the precondition for anything
      // downstream (demands, strikes) to ever happen at all. Union dues v1
      // retired the recruitment drive this test used to also assert
      // (membershipPressure moving off its seed), members are now a real
      // headcount derived from represented-sector workers x unionization every
      // turn (`processUnionsTurn`), so there is nothing left here to recruit.
      expect(result.leadersElected).toBe(6);
      for (const union of unions) {
        expect(union.ownerId).not.toBeNull();
        expect(union.ownerType).toBe("npp");
      }
    }
  );

  it("is a no-op when labourSystemMode is below 'unions'", async () => {
    labourSystemMode = "off";
    const unions = [makeUnion("PL")];
    const npps = [makeMilitantNpp("PL")];
    const { db, unionsBulkWrite } = mockDb({ unions, npps });

    const result = await processNppUnionBehavior(db, 1);

    expect(result.leadersElected).toBe(0);
    expect(unionsBulkWrite).not.toHaveBeenCalled();
    labourSystemMode = "full"; // reset for subsequent tests
  });

  it("is a no-op when NPP autonomy is below 'v3'", async () => {
    nppAutonomyLevel = "off";
    const unions = [makeUnion("PL")];
    const npps = [makeMilitantNpp("PL")];
    const { db, unionsBulkWrite } = mockDb({ unions, npps });

    const result = await processNppUnionBehavior(db, 1);

    expect(result.leadersElected).toBe(0);
    expect(unionsBulkWrite).not.toHaveBeenCalled();
    nppAutonomyLevel = "v3"; // reset for subsequent tests
  });

  it("opens one employer-scoped campaign for an organized NPP-led union", async () => {
    const leader = makeMilitantNpp("US");
    const ledUnion = makeUnion("US", {
      ownerId: leader._id,
      ownerType: "npp",
    });
    const corporationId = new ObjectId();
    const sector = {
      _id: new ObjectId(),
      corporationId,
      countryId: "US",
      sectorType: "manufacturing",
      workers: 1000,
      unionization: 65,
      wageLevel: 1,
      profitMargin: 12,
    } as CorporateSector;
    const corporation = {
      _id: corporationId,
      ceoType: "character",
      ceoId: new ObjectId(),
    } as Corporation;
    const { db, sectorsFind } = mockDb({
      unions: [ledUnion],
      npps: [leader],
      sectors: [sector],
      corporations: [corporation],
    });

    const result = await processNppUnionBehavior(db, 10);

    expect(result.campaignsOpened).toBe(1);
    expect(sectorsFind).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        projection: {
          _id: 1,
          corporationId: 1,
          countryId: 1,
          sectorType: 1,
          workers: 1,
          unionization: 1,
          wageLevel: 1,
          profitMargin: 1,
        },
      })
    );
    expect(openBargainingCampaignFromLiveConditions).toHaveBeenCalledWith(
      db,
      ledUnion,
      corporationId.toHexString(),
      expect.objectContaining({
        agreementDurationTurns: 48,
        noStrikeTurns: 24,
      }),
      10
    );
    expect(
      vi.mocked(openBargainingCampaignFromLiveConditions).mock.calls[0][3].wageLevel
    ).toBeGreaterThan(1);
    expect(ledUnion.demandedWageLevel).toBeNull();
  });

  it("lets an NPP CEO counter a player-led union campaign", async () => {
    const playerUnion = makeUnion("US", {
      ownerId: new ObjectId(),
      ownerType: "character",
    });
    const employerId = new ObjectId();
    const sectorId = new ObjectId();
    const sector = {
      _id: sectorId,
      corporationId: employerId,
      countryId: "US",
      sectorType: "manufacturing",
      workers: 1000,
      unionization: 60,
      wageLevel: 1,
      profitMargin: 10,
    } as CorporateSector;
    const employer = {
      _id: employerId,
      ceoType: "npp",
      ceoId: new ObjectId(),
    } as Corporation;
    const offer = {
      revision: 1,
      proposedBy: "union" as const,
      wageLevel: 1.2,
      agreementDurationTurns: 48,
      noStrikeTurns: 24,
      proposedAtTurn: 1,
      proposedAt: new Date(),
    };
    const campaign = {
      _id: new ObjectId(),
      unionId: playerUnion._id,
      countryId: "US",
      sectorType: "manufacturing",
      employerCorporationId: employerId,
      sectorIds: [sectorId],
      status: "negotiating",
      escalationLevel: "none",
      mandate: {
        coverage: 60,
        grievance: 50,
        laborTightness: 50,
        lawSupport: 50,
        strikeFundRunway: 3,
        support: 60,
        leverage: 60,
        organizedLocalCount: 1,
        totalLocalCount: 1,
      },
      currentOffer: offer,
      offers: [offer],
      startedAtTurn: 1,
      deadlineTurn: 9,
      lastActionTurn: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as BargainingCampaign;
    const { db } = mockDb({
      unions: [playerUnion],
      npps: [],
      sectors: [sector],
      corporations: [employer],
      campaigns: [campaign],
    });

    const result = await processNppUnionBehavior(db, 2);

    expect(result.counteroffersMade).toBe(1);
    expect(persistBargainingCounter).toHaveBeenCalledWith(
      db,
      campaign,
      "employer",
      expect.any(Object),
      2
    );
    expect(vi.mocked(persistBargainingCounter).mock.calls[0][3].wageLevel).toBeLessThan(1.2);
  });

  it("lets an NPP-led union accept an adequate player CEO counteroffer", async () => {
    const leader = makeMilitantNpp("US");
    const ledUnion = makeUnion("US", {
      ownerId: leader._id,
      ownerType: "npp",
    });
    const employerId = new ObjectId();
    const sectorId = new ObjectId();
    const sector = {
      _id: sectorId,
      corporationId: employerId,
      countryId: "US",
      sectorType: "manufacturing",
      workers: 1000,
      unionization: 60,
      wageLevel: 1,
      profitMargin: 10,
    } as CorporateSector;
    const employer = {
      _id: employerId,
      ceoType: "character",
      ceoId: new ObjectId(),
    } as Corporation;
    const unionOffer = {
      revision: 1,
      proposedBy: "union" as const,
      wageLevel: 1.2,
      agreementDurationTurns: 48,
      noStrikeTurns: 24,
      proposedAtTurn: 1,
      proposedAt: new Date(),
    };
    const employerOffer = {
      ...unionOffer,
      revision: 2,
      proposedBy: "employer" as const,
      wageLevel: 1.2,
      proposedAtTurn: 2,
    };
    const campaign = {
      _id: new ObjectId(),
      unionId: ledUnion._id,
      countryId: "US",
      sectorType: "manufacturing",
      employerCorporationId: employerId,
      sectorIds: [sectorId],
      status: "negotiating",
      escalationLevel: "none",
      mandate: {
        coverage: 60,
        grievance: 50,
        laborTightness: 50,
        lawSupport: 50,
        strikeFundRunway: 3,
        support: 60,
        leverage: 60,
        organizedLocalCount: 1,
        totalLocalCount: 1,
      },
      currentOffer: employerOffer,
      offers: [unionOffer, employerOffer],
      startedAtTurn: 1,
      deadlineTurn: 9,
      lastActionTurn: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as BargainingCampaign;
    const { db } = mockDb({
      unions: [ledUnion],
      npps: [leader],
      sectors: [sector],
      corporations: [employer],
      campaigns: [campaign],
    });

    const result = await processNppUnionBehavior(db, 3);

    expect(result.agreementsSettled).toBe(1);
    expect(persistBargainingSettlement).toHaveBeenCalledWith(db, campaign, "union", 3);
  });

  it("does not reopen an employer while an active agreement covers it", async () => {
    const leader = makeMilitantNpp("US");
    const ledUnion = makeUnion("US", {
      ownerId: leader._id,
      ownerType: "npp",
    });
    const employerId = new ObjectId();
    const sectorId = new ObjectId();
    const sector = {
      _id: sectorId,
      corporationId: employerId,
      countryId: "US",
      sectorType: "manufacturing",
      workers: 1000,
      unionization: 60,
      wageLevel: 1,
    } as CorporateSector;
    const agreement = {
      unionId: ledUnion._id,
      employerCorporationId: employerId,
      sectorIds: [sectorId],
      status: "active",
      expiresAtTurn: 50,
    } as CollectiveAgreement;
    const { db } = mockDb({
      unions: [ledUnion],
      npps: [leader],
      sectors: [sector],
      corporations: [{ _id: employerId } as Corporation],
      agreements: [agreement],
    });

    const result = await processNppUnionBehavior(db, 10);

    expect(result.campaignsOpened).toBe(0);
    expect(openBargainingCampaignFromLiveConditions).not.toHaveBeenCalled();
  });

  it("routes NPP industrial action through the shared escalation service", async () => {
    const leader = makeMilitantNpp("US");
    const ledUnion = makeUnion("US", {
      ownerId: leader._id,
      ownerType: "npp",
      treasury: 10_000,
    });
    const employerId = new ObjectId();
    const sectorId = new ObjectId();
    const sector = {
      _id: sectorId,
      corporationId: employerId,
      countryId: "US",
      sectorType: "manufacturing",
      workers: 1000,
      unionization: 70,
      wageLevel: 1,
      profitMargin: 12,
    } as CorporateSector;
    const employer = {
      _id: employerId,
      ceoType: "character",
      ceoId: new ObjectId(),
    } as Corporation;
    const offer = {
      revision: 1,
      proposedBy: "union" as const,
      wageLevel: 1.2,
      agreementDurationTurns: 48,
      noStrikeTurns: 24,
      proposedAtTurn: 1,
      proposedAt: new Date(),
    };
    const campaign = {
      _id: new ObjectId(),
      unionId: ledUnion._id,
      countryId: "US",
      sectorType: "manufacturing",
      employerCorporationId: employerId,
      sectorIds: [sectorId],
      status: "dispute",
      escalationLevel: "none",
      mandate: {
        coverage: 70,
        grievance: 50,
        laborTightness: 50,
        lawSupport: 50,
        strikeFundRunway: 3,
        support: 70,
        leverage: 65,
        organizedLocalCount: 1,
        totalLocalCount: 1,
      },
      currentOffer: offer,
      offers: [offer],
      startedAtTurn: 1,
      deadlineTurn: 9,
      disputeStartedAtTurn: 1,
      lastActionTurn: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as BargainingCampaign;
    const { db } = mockDb({
      unions: [ledUnion],
      npps: [leader],
      sectors: [sector],
      corporations: [employer],
      campaigns: [campaign],
    });

    const result = await processNppUnionBehavior(db, 3);

    expect(result.disputesEscalated).toBe(1);
    expect(persistUnionBargainingEscalation).toHaveBeenCalledWith(db, ledUnion, campaign, 3);
  });

  it("vacates a retired NPP leader instead of leaving the union inert", async () => {
    const ledUnion = makeUnion("US", {
      ownerId: new ObjectId(),
      ownerType: "npp",
    });
    const { db, unionsUpdateMany } = mockDb({ unions: [ledUnion], npps: [] });

    await processNppUnionBehavior(db, 10);

    expect(unionsUpdateMany).toHaveBeenCalledWith(
      { _id: { $in: [ledUnion._id] } },
      expect.objectContaining({
        $set: expect.objectContaining({ ownerId: null }),
        $unset: { ownerType: "" },
      })
    );
  });
});

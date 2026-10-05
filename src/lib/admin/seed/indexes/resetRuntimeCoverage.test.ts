import { describe, expect, it } from "vitest";
import { collectSeedIndexPlan } from "./plan";

const NEW_RUNTIME_COLLECTIONS = [
  "truces",
  "vietnamEscalation",
  "appliedWorldTransitions",
  "sphereFlowLedger",
  "bankingTelemetry",
  "acquisitionSettlements",
  "mergerReviews",
  "indexListingPetitions",
  "speakerLeadershipBallots",
  "senateLeadershipBallots",
  "bargainingRatificationBallots",
  "balanceSnapshotCheckpoints",
  "equityLiquidityFacilitySnapshots",
  "nppOperatorDiagnostics",
  "capacityDecisionFunnels",
  "bondSaleIntents",
  "ngChamberLeadershipElections",
  "ngChamberLeadershipNominations",
] as const;

// These collections' source reads are by `_id` only. Mongo recreates the
// built-in primary-key index when reset drops the collection.
const PRIMARY_KEY_ONLY = [
  "vietnamEscalation",
  "appliedWorldTransitions",
  "bankingTelemetry",
  "acquisitionSettlements",
  "ngChamberLeadershipElections",
] as const;

// These two telemetry documents are also keyed by `_id`; their only non-ID
// operation is a retention sweep bounded to at most 48 documents per world.
const BOUNDED_RETENTION_SCAN = ["nppOperatorDiagnostics", "capacityDecisionFunnels"] as const;

describe("fresh-reset index coverage for newly classified runtime collections", () => {
  it("plans indexes for every collection with a secondary-index query path", async () => {
    const plan = await collectSeedIndexPlan();
    const plannedCollections = new Set(
      plan
        .filter((entry) =>
          (NEW_RUNTIME_COLLECTIONS as readonly string[]).includes(entry.collection)
        )
        .map((entry) => entry.collection)
    );
    const exempt = new Set<string>([...PRIMARY_KEY_ONLY, ...BOUNDED_RETENTION_SCAN]);

    expect(new Set([...plannedCollections, ...exempt])).toEqual(new Set(NEW_RUNTIME_COLLECTIONS));
    expect([...plannedCollections].filter((name) => exempt.has(name))).toEqual([]);
  });

  it("restores the migration-defined petition and ratification indexes on bootstrap", async () => {
    const plan = await collectSeedIndexPlan();
    const index = (collection: string, name: string) =>
      plan.find((entry) => entry.collection === collection && entry.options.name === name);

    expect(
      index("indexListingPetitions", "unique_pending_index_listing_petition_per_corp")
    ).toMatchObject({ key: { corporationId: 1 }, options: { unique: true } });
    expect(index("indexListingPetitions", "index_listing_petitions_active_waivers")).toMatchObject({
      key: { status: 1, waiverUntilTurn: 1 },
    });
    expect(index("indexListingPetitions", "index_listing_petitions_due")).toMatchObject({
      key: { status: 1, deadlineAtTurn: 1 },
    });
    expect(index("indexListingPetitions", "index_listing_petitions_country_inbox")).toMatchObject({
      key: { countryId: 1, status: 1, deadlineAtTurn: 1 },
    });
    expect(
      index("bargainingRatificationBallots", "unique_ratification_ballot_per_organizer")
    ).toMatchObject({
      key: { campaignId: 1, offerRevision: 1, voterCharacterId: 1 },
      options: { unique: true },
    });
  });

  it("captures the active secondary query paths for the other runtime collections", async () => {
    const plan = await collectSeedIndexPlan();
    const keys = (collection: string) =>
      plan.filter((entry) => entry.collection === collection).map((entry) => entry.key);

    expect(keys("truces")).toContainEqual({ countries: 1, expiresTurn: 1 });
    expect(keys("sphereFlowLedger")).toContainEqual({ memberId: 1, turn: -1, createdAt: -1 });
    expect(keys("mergerReviews")).toEqual(
      expect.arrayContaining([
        { acquirerCorporationId: 1, targetCorporationId: 1, status: 1 },
        { status: 1, decideByTurn: 1 },
        { countryId: 1, status: 1, decideByTurn: 1 },
        { countryId: 1, status: 1, resolvedAtTurn: -1, createdAt: -1 },
        { acquirerCorporationId: 1, createdAt: -1 },
        { targetCorporationId: 1, createdAt: -1 },
      ])
    );
    expect(keys("bondSaleIntents")).toEqual(
      expect.arrayContaining([
        { status: 1, createdAt: 1 },
        { bondId: 1, holderKey: 1, holderId: 1, status: 1 },
      ])
    );
    expect(keys("ngChamberLeadershipNominations")).toEqual(
      expect.arrayContaining([
        { role: 1, status: 1, votesFor: -1 },
        { role: 1, nomineeId: 1, status: 1 },
      ])
    );
  });
});

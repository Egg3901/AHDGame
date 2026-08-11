/**
 * Phase-6 end-to-end smoke: force-fire a conversion via the public
 * `triggerSystemConversion` entry point and assert every observable
 * side-effect lands together — governmentType flip, regimeStatus
 * wipe, opsVoteMultipliers cleared, snap-election marker parked,
 * history entry appended.
 *
 * Lighter than the unit tests in `systemConversion.test.ts` (which
 * verify per-call behaviour); this one stitches the whole flow and
 * checks the steady-state shape a UI reader would see after the
 * conversion lands.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { triggerSystemConversion } from "@/lib/onePartyState/systemConversion";
import type { CountryState } from "@/lib/db/types/countryState";
import { DEFAULT_OPS_VOTE_MULTIPLIERS } from "@/lib/constants/countries";

function makeCountryState(overrides: Partial<CountryState> = {}): CountryState {
  return {
    _id: "CN",
    countryId: "CN",
    governmentType: "onePartyState",
    rulingPartyId: 1,
    opsVoteMultipliers: { ...DEFAULT_OPS_VOTE_MULTIPLIERS },
    hasLeaderConfidenceModel: true,
    reformCooldowns: {},
    popularBoostModifiers: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Phase-6 conversion E2E smoke", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("countryState");
    db.collection("politicalParties");
    db.collection("countryHistory");
    db.collectionMocks.countryState.findOne.mockResolvedValue(makeCountryState());
    db.collectionMocks.countryState.findOneAndUpdate.mockResolvedValue(makeCountryState());
  });

  it("voluntary convention path: every observable conversion side-effect lands together", async () => {
    await triggerSystemConversion(db as unknown as Db, "CN", 500, {
      targetSystem: "parliamentaryRepublic",
      legacyReservation: 20,
      path: "voluntary",
      electionAtTurn: 524,
    });

    const stateWrites = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;

    // 1. governmentType flipped + OPS knobs cleared atomically
    const flipCall = stateWrites.find((c) => {
      const op = c[1] as {
        $set?: {
          governmentType?: string;
          opsVoteMultipliers?: unknown;
          hasLeaderConfidenceModel?: boolean;
        };
      };
      return (
        op.$set?.governmentType === "parliamentaryRepublic" &&
        op.$set?.opsVoteMultipliers === null &&
        op.$set?.hasLeaderConfidenceModel === false
      );
    });
    expect(flipCall).toBeDefined();

    // 2. All party regimeStatus cleared in one updateMany
    const partyCalls = db.collectionMocks.politicalParties.updateMany.mock.calls;
    expect(partyCalls).toHaveLength(1);
    expect((partyCalls[0][0] as { countryId: string }).countryId).toBe("CN");
    expect((partyCalls[0][1] as { $set: { regimeStatus: unknown } }).$set.regimeStatus).toBeNull();

    // 3. Snap-election marker written (captures legacy reservation + party id + voluntary path)
    const markerCall = stateWrites.find((c) => {
      const op = c[1] as {
        $set?: {
          pendingPostConversionElection?: {
            atTurn: number;
            legacyReservation: number;
            formerRulingPartyId: number | null;
            path: string;
          };
        };
      };
      return op.$set?.pendingPostConversionElection?.atTurn === 524;
    });
    expect(markerCall).toBeDefined();
    const marker = (
      markerCall![1] as {
        $set: {
          pendingPostConversionElection: {
            atTurn: number;
            legacyReservation: number;
            formerRulingPartyId: number | null;
            path: string;
          };
        };
      }
    ).$set.pendingPostConversionElection;
    expect(marker.legacyReservation).toBe(20);
    expect(marker.formerRulingPartyId).toBe(1);
    expect(marker.path).toBe("voluntary");

    // 4. Country-history entry appended with subtype:"conversion"
    const inserts = db.collectionMocks.countryHistory.insertOne.mock.calls;
    expect(inserts.length).toBeGreaterThan(0);
    const evt = inserts[0][0] as {
      eventType: string;
      title: string;
      details: { subtype: string; path: string; targetSystem: string };
    };
    expect(evt.eventType).toBe("regime_escalation");
    expect(evt.title).toMatch(/adopts parliamentaryRepublic/i);
    expect(evt.details.subtype).toBe("conversion");
    expect(evt.details.path).toBe("voluntary");
    expect(evt.details.targetSystem).toBe("parliamentaryRepublic");
  });

  it("forced (Stage-4 acceptPeacefully) path: stamps the -20% vote-share penalty on the marker", async () => {
    await triggerSystemConversion(db as unknown as Db, "CN", 700, {
      targetSystem: "parliamentaryRepublic",
      legacyReservation: 5,
      path: "forced",
      forcedVoteSharePenalty: -0.2,
      electionAtTurn: 712,
    });

    const stateWrites = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const markerCall = stateWrites.find((c) => {
      const op = c[1] as {
        $set?: {
          pendingPostConversionElection?: {
            forcedVoteSharePenalty?: number;
            legacyReservation: number;
            path: string;
          };
        };
      };
      return op.$set?.pendingPostConversionElection?.forcedVoteSharePenalty === -0.2;
    });
    expect(markerCall).toBeDefined();
    const marker = (
      markerCall![1] as {
        $set: {
          pendingPostConversionElection: {
            forcedVoteSharePenalty: number;
            legacyReservation: number;
            path: string;
          };
        };
      }
    ).$set.pendingPostConversionElection;
    expect(marker.legacyReservation).toBe(5);
    expect(marker.path).toBe("forced");
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { bootstrapNewSystem } from "@/lib/onePartyState/conversionBootstrap";
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

describe("bootstrapNewSystem", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("countryState");
    db.collectionMocks.countryState.findOne.mockResolvedValue(makeCountryState());
    db.collectionMocks.countryState.findOneAndUpdate.mockResolvedValue(makeCountryState());
  });

  it("writes pendingPostConversionElection with the captured former ruling party id", async () => {
    await bootstrapNewSystem(db as unknown as Db, "CN", {
      targetSystem: "parliamentaryRepublic",
      legacyReservation: 20,
      path: "voluntary",
      electionAtTurn: 500,
    });

    const writes = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const patchCall = writes.find((c) => {
      const op = c[1] as { $set?: { pendingPostConversionElection?: { atTurn?: number } } };
      return op.$set?.pendingPostConversionElection?.atTurn === 500;
    });
    expect(patchCall).toBeDefined();
    const marker = (
      patchCall![1] as {
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
  });

  it("captures forcedVoteSharePenalty on a forced-path bootstrap", async () => {
    await bootstrapNewSystem(db as unknown as Db, "CN", {
      targetSystem: "parliamentaryRepublic",
      legacyReservation: 5,
      path: "forced",
      forcedVoteSharePenalty: -0.2,
      electionAtTurn: 600,
    });

    const writes = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const patchCall = writes.find((c) => {
      const op = c[1] as {
        $set?: { pendingPostConversionElection?: { forcedVoteSharePenalty?: number } };
      };
      return op.$set?.pendingPostConversionElection?.forcedVoteSharePenalty === -0.2;
    });
    expect(patchCall).toBeDefined();
  });

  it("captures null formerRulingPartyId when the country has no ruling party at conversion", async () => {
    db.collectionMocks.countryState.findOne.mockResolvedValue(
      makeCountryState({ rulingPartyId: null })
    );

    await bootstrapNewSystem(db as unknown as Db, "CN", {
      targetSystem: "presidential",
      legacyReservation: 0,
      path: "voluntary",
      electionAtTurn: 800,
    });

    const writes = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const patchCall = writes.find((c) => {
      const op = c[1] as {
        $set?: { pendingPostConversionElection?: { formerRulingPartyId?: number | null } };
      };
      return (
        op.$set?.pendingPostConversionElection !== undefined &&
        op.$set.pendingPostConversionElection.formerRulingPartyId === null
      );
    });
    expect(patchCall).toBeDefined();
  });
});

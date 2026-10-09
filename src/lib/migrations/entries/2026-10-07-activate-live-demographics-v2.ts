import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { verifyDemographicsV2Opening } from "@/lib/demographics/v2/verifyOpening";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import {
  resetSeedComplete,
  resetSystemSelectionsFrom,
  resetSystemVersionsFrom,
} from "@/lib/resetVersions/rules";
import type { Migration, MigrationContext, MigrationResult } from "../types";

export const LIVE_DEMOGRAPHICS_V2_MIGRATION_ID = "2026-10-07-activate-live-demographics-v2";

const MIGRATION_ACTOR = `migration:${LIVE_DEMOGRAPHICS_V2_MIGRATION_ID}`;
const LIVE_ACTIVATION_COUNTRIES = ["US", "UK", "JP", "IE"] as const;

type ActivationState = Pick<
  GameState,
  | "_id"
  | "currentTurn"
  | "isActive"
  | "resetWorldId"
  | "resetVersionSeeds"
  | "resetSystemSelections"
  | "demographicsSystemVersion"
>;

const ACTIVATION_PROJECTION = {
  _id: 1,
  currentTurn: 1,
  isActive: 1,
  resetWorldId: 1,
  resetVersionSeeds: 1,
  resetSystemSelections: 1,
  demographicsSystemVersion: 1,
} as const;

function assertActivatableWorld(state: ActivationState | null): asserts state is ActivationState & {
  currentTurn: number;
  resetWorldId: string;
} {
  if (!state) throw new Error("Cannot activate Demographics v2 without the current gameState");
  if (state.isActive !== true) {
    throw new Error("Demographics v2 live promotion requires the current world to be active");
  }
  if (!Number.isSafeInteger(state.currentTurn) || (state.currentTurn ?? 0) < 1) {
    throw new Error("Demographics v2 live promotion requires a valid current turn");
  }
  if (typeof state.resetWorldId !== "string" || state.resetWorldId.length === 0) {
    throw new Error("Demographics v2 live promotion requires an existing reset world identity");
  }
}

function alreadyActivated(state: ActivationState): boolean {
  return (
    resetSystemVersionsFrom(state, RESET_V2_READY).demographics === "v2" &&
    resetSystemSelectionsFrom(state).demographics === "v2" &&
    LIVE_ACTIVATION_COUNTRIES.every((countryId) =>
      state.resetVersionSeeds?.demographics?.countries?.includes(countryId)
    )
  );
}

async function activateLiveDemographicsV2(db: Db, ctx: MigrationContext): Promise<MigrationResult> {
  const collection = db.collection<GameState>("gameState");
  const state = await collection.findOne({ _id: "current" }, { projection: ACTIVATION_PROJECTION });
  assertActivatableWorld(state);

  if (alreadyActivated(state)) {
    return {
      documentsScanned: 1,
      documentsUpdated: 0,
      notes: ["The active world already has a complete Demographics v2 receipt and selection."],
    };
  }

  const receipt = await verifyDemographicsV2Opening(
    db,
    state.resetWorldId,
    state.currentTurn,
    LIVE_ACTIVATION_COUNTRIES
  );
  const activatedAt = new Date().toISOString();
  const promotedState: ActivationState = {
    ...state,
    demographicsSystemVersion: "v2",
    resetVersionSeeds: { ...state.resetVersionSeeds, demographics: receipt },
    resetSystemSelections: { ...state.resetSystemSelections, demographics: "v2" },
  };
  if (
    resetSystemVersionsFrom(promotedState, RESET_V2_READY).demographics !== "v2" ||
    !resetSeedComplete(promotedState, "demographics")
  ) {
    throw new Error("Demographics v2 receipt did not satisfy the runtime activation contract");
  }

  if (ctx.dryRun) {
    return {
      documentsScanned: 1,
      documentsUpdated: 0,
      notes: [
        "DRY RUN, no writes. The active world's US, UK, JP, and inactive IE population vectors passed verification.",
        "Apply will atomically install the receipt, activate Demographics v2, and select v2 for the next reset.",
        "SCO and WAL remain deferred until independence creates and verifies their successor-region vectors.",
      ],
    };
  }

  const update = await collection.updateOne(
    {
      _id: "current",
      isActive: true,
      currentTurn: state.currentTurn,
      resetWorldId: state.resetWorldId,
    },
    {
      $set: {
        demographicsSystemVersion: "v2",
        demographicsSystemVersionBy: MIGRATION_ACTOR,
        demographicsSystemVersionAt: activatedAt,
        "resetVersionSeeds.demographics": receipt,
        "resetSystemSelections.demographics": "v2",
        "resetSystemSelectionsAudit.demographics": {
          by: MIGRATION_ACTOR,
          at: activatedAt,
        },
        updatedAt: new Date(activatedAt),
      },
    }
  );
  if (update.matchedCount !== 1) {
    throw new Error(
      "The active world changed during Demographics v2 verification; no activation was applied"
    );
  }

  const activated = await collection.findOne(
    { _id: "current" },
    { projection: ACTIVATION_PROJECTION }
  );
  if (
    !activated ||
    resetSystemVersionsFrom(activated, RESET_V2_READY).demographics !== "v2" ||
    resetSystemSelectionsFrom(activated).demographics !== "v2"
  ) {
    throw new Error("Demographics v2 activation did not pass its post-write verification");
  }

  return {
    documentsScanned: 1,
    documentsUpdated: update.modifiedCount,
    notes: [
      "Activated Demographics v2 after verifying US, UK, JP, and inactive IE population vectors.",
      "Selected Demographics v2 for the next reset without changing any other reset-system selection.",
      "SCO and WAL remain deferred until independence creates and verifies their successor-region vectors.",
    ],
  };
}

export const migration: Migration = {
  id: LIVE_DEMOGRAPHICS_V2_MIGRATION_ID,
  description:
    "Verify the active world's demographic substrate and atomically promote it to Demographics v2",
  idempotent: true,
  execute: activateLiveDemographicsV2,
};

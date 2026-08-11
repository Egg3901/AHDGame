/**
 * Stage 1 — "Address discontent" decision handler.
 *
 * Fires when popularLegitimacy drops below 60 for 12 turns. Three
 * options + an "ignore" default. See design doc § Stage 1 decision
 * event for the costs / effects table.
 */
import type { DecisionHandler, DecisionOption } from "./types";
import { adjustLeaderConfidence } from "@/lib/turn/rulingPartyConfidence";
import { adjustPopularLegitimacy } from "@/lib/turn/popularLegitimacy";
import { recordPurgeEvent } from "@/lib/onePartyState/partyEffectAdapters";
import {
  setPopularDecayModifier,
  bumpStage1Dwell,
} from "@/lib/onePartyState/escalationStateMutators";
import { getCountryStateCollection } from "@/lib/db/collections/countryState";

const acknowledge: DecisionOption = {
  id: "acknowledge",
  label: "Acknowledge & promise reform",
  description:
    "Publicly acknowledge the discontent. Costs intra-party confidence (hardliners disapprove) but lifts public mood and unlocks one liberalization menu use this turn at half cost.",
  async apply(ctx) {
    await adjustLeaderConfidence(
      ctx.db,
      ctx.countryId,
      ctx.leaderCharacterId,
      -2,
      "Decision: Acknowledge discontent",
      ctx.currentTurn
    );
    await adjustPopularLegitimacy(
      ctx.db,
      ctx.countryId,
      ctx.leaderCharacterId,
      3,
      "Decision: Acknowledge discontent",
      ctx.currentTurn
    );
    // Phase-5 reform actions read pendingReformDiscount.turn === currentTurn
    // to halve the next reform's intra-party cost. Written directly via
    // the collection accessor since the field isn't on the typed
    // CountryStatePatch yet (Phase 5 expands the patch surface).
    await getCountryStateCollection(ctx.db).updateOne(
      { _id: ctx.countryId },
      {
        $set: {
          pendingReformDiscount: { turn: ctx.currentTurn, multiplier: 0.5 },
          updatedAt: new Date(),
        },
      }
    );
  },
};

const crackDown: DecisionOption = {
  id: "crackDown",
  label: "Crack down (deploy security)",
  description:
    "Order a security response. Costs popular legitimacy and generates a minor purge event, but halves popular decay for the next 24 turns.",
  async apply(ctx) {
    await adjustPopularLegitimacy(
      ctx.db,
      ctx.countryId,
      ctx.leaderCharacterId,
      -1,
      "Decision: Crack down on protests",
      ctx.currentTurn
    );
    await recordPurgeEvent(ctx.db, ctx.countryId, {
      severity: "minor",
      kind: "discipline",
      reason: "Stage-1 crackdown",
      turn: ctx.currentTurn,
    });
    await setPopularDecayModifier(ctx.db, ctx.countryId, {
      multiplier: 0.5,
      untilTurn: ctx.currentTurn + 24,
    });
  },
};

const ignore: DecisionOption = {
  id: "ignore",
  label: "Ignore",
  description:
    "Take no public action. Popular decay rate +25% for the next 24 turns, and the Stage 1 dwell counter takes a small additional bump.",
  async apply(ctx) {
    await setPopularDecayModifier(ctx.db, ctx.countryId, {
      multiplier: 1.25,
      untilTurn: ctx.currentTurn + 24,
    });
    await bumpStage1Dwell(ctx.db, ctx.countryId, 2);
  },
};

export const stage1AddressDiscontentHandler: DecisionHandler = {
  kind: "stage1.addressDiscontent",
  options: [acknowledge, crackDown, ignore],
  defaultOptionId: "ignore",
};

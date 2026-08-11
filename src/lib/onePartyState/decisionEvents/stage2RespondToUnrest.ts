/**
 * Stage 2 — "Respond to mass unrest" decision handler.
 *
 * Fires when popularLegitimacy stays at or below 35 for the sustained
 * (36-turn) or cumulative-in-168 (48-turn) thresholds. Four options +
 * an "ignore" default. See design doc § Stage 2 decision event.
 */
import type { DecisionHandler, DecisionOption } from "./types";
import { adjustLeaderConfidence } from "@/lib/turn/rulingPartyConfidence";
import { adjustPopularLegitimacy } from "@/lib/turn/popularLegitimacy";
import { recordPurgeEvent, legalizeBannedParty } from "@/lib/onePartyState/partyEffectAdapters";
import {
  setPopularDecayModifier,
  setStage2DwellDecayBoost,
  setStage3Block,
} from "@/lib/onePartyState/escalationStateMutators";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";

const openDialogue: DecisionOption = {
  id: "openDialogue",
  label: "Open dialogue",
  description:
    "Call a public hearing to acknowledge the protests' demands. Costs intra-party confidence but gives a +6 popular boost and doubles the Stage 2 dwell counter's decay rate for 48 turns — buying real recovery time.",
  async apply(ctx) {
    await adjustLeaderConfidence(
      ctx.db,
      ctx.countryId,
      ctx.leaderCharacterId,
      -3,
      "Decision: Open dialogue (Stage 2)",
      ctx.currentTurn
    );
    await adjustPopularLegitimacy(
      ctx.db,
      ctx.countryId,
      ctx.leaderCharacterId,
      6,
      "Decision: Open dialogue (Stage 2)",
      ctx.currentTurn
    );
    await setStage2DwellDecayBoost(ctx.db, ctx.countryId, {
      multiplier: 2,
      untilTurn: ctx.currentTurn + 48,
    });
  },
};

const selectiveConcession: DecisionOption = {
  id: "selectiveConcession",
  label: "Selective concession (legalize a banned party)",
  description:
    "Legalize a chosen banned party. Costs intra-party confidence but lifts public mood. Payload must include `bannedPartyId` — the sequentialId of the party to promote.",
  async apply(ctx) {
    const partyId = readBannedPartyId(ctx.decision.payload);
    if (partyId === null) {
      throw new Error(
        "stage2.respondToUnrest.selectiveConcession requires payload.bannedPartyId (number)"
      );
    }
    await adjustLeaderConfidence(
      ctx.db,
      ctx.countryId,
      ctx.leaderCharacterId,
      -5,
      `Decision: Legalize party ${partyId}`,
      ctx.currentTurn
    );
    await adjustPopularLegitimacy(
      ctx.db,
      ctx.countryId,
      ctx.leaderCharacterId,
      10,
      `Decision: Legalize party ${partyId}`,
      ctx.currentTurn
    );
    await legalizeBannedParty(ctx.db, ctx.countryId, partyId);
    // Log the legalization to the country-history feed tagged with the
    // beneficiary partyId so the approved-party UI surface can render
    // an inbox-style "You were legalized" notice via a partyId filter.
    await recordCountryEvent(ctx.db, {
      countryId: ctx.countryId,
      turn: ctx.currentTurn,
      eventType: "regime_escalation",
      title: `Party ${partyId} legalized by ruling-party concession`,
      party: String(partyId),
      details: {
        subtype: "selective_concession",
        bannedPartyId: partyId,
      },
    }).catch((err) => console.error(`${ctx.countryId} selective_concession history failed:`, err));
  },
};

const martialLaw: DecisionOption = {
  id: "martialLaw",
  label: "Martial law",
  description:
    "Suppress the protests by force. Direct: -8 popular. Also inserts an extreme-severity `discipline` purge event that bleeds into both drivers over subsequent turns. In exchange, the popular-decay modifier is set to 0× for 72 turns (popular legitimacy stops falling at all) and Stage-3 escalation is blocked for the same 72-turn window. High-risk: if the Stage-3 dwell counter is already past its threshold when the block expires, this only delayed the inevitable.",
  async apply(ctx) {
    await adjustPopularLegitimacy(
      ctx.db,
      ctx.countryId,
      ctx.leaderCharacterId,
      -8,
      "Decision: Martial law (Stage 2)",
      ctx.currentTurn
    );
    await recordPurgeEvent(ctx.db, ctx.countryId, {
      severity: "extreme",
      kind: "discipline",
      reason: "Stage 2 martial law",
      turn: ctx.currentTurn,
    });
    await setPopularDecayModifier(ctx.db, ctx.countryId, {
      multiplier: 0,
      untilTurn: ctx.currentTurn + 72,
    });
    await setStage3Block(ctx.db, ctx.countryId, {
      untilTurn: ctx.currentTurn + 72,
    });
  },
};

const ignore: DecisionOption = {
  id: "ignore",
  label: "Ignore",
  description:
    "Take no public action. Popular decay rate +50% for the next 48 turns — accelerates the path to Stage 3.",
  async apply(ctx) {
    await setPopularDecayModifier(ctx.db, ctx.countryId, {
      multiplier: 1.5,
      untilTurn: ctx.currentTurn + 48,
    });
  },
};

function readBannedPartyId(payload: Record<string, unknown>): number | null {
  const raw = payload["bannedPartyId"];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

export const stage2RespondToUnrestHandler: DecisionHandler = {
  kind: "stage2.respondToUnrest",
  options: [openDialogue, selectiveConcession, martialLaw, ignore],
  defaultOptionId: "ignore",
};

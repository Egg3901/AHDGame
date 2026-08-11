/**
 * Stage 4 — "Face the collapse" decision handler.
 *
 * Fires when popularLegitimacy stays below 15 for 72 turns while
 * already in Stage 3 (internalChallenge) AND no constitutional
 * convention is in progress. Two options; the default
 * (`acceptPeacefully`) hands the regime to Phase 6's
 * `systemConversion` driver on the next per-turn tick.
 */
import type { DecisionHandler, DecisionOption } from "./types";
import { adjustLeaderConfidence } from "@/lib/turn/rulingPartyConfidence";
import { adjustPopularLegitimacy } from "@/lib/turn/popularLegitimacy";
import { recordPurgeEvent, banAllApprovedParties } from "@/lib/onePartyState/partyEffectAdapters";
import {
  setConversionPendingAtTurn,
  setStage4Delay,
} from "@/lib/onePartyState/escalationStateMutators";

const RESIST_DELAY_TURNS = 48;

const resist: DecisionOption = {
  id: "resist",
  label: "Resist the collapse",
  description:
    "Refuse to concede. Bans every approved party, fires one extreme `faction` purge (-25 intra-party, -20 popular), and buys 48 turns before the system conversion fires. If popular legitimacy is still below 15 at the delay's end, the post-conversion legacy seat reservation is halved as punishment.",
  async apply(ctx) {
    await adjustLeaderConfidence(
      ctx.db,
      ctx.countryId,
      ctx.leaderCharacterId,
      -25,
      "Decision: Resist collapse",
      ctx.currentTurn
    );
    await adjustPopularLegitimacy(
      ctx.db,
      ctx.countryId,
      ctx.leaderCharacterId,
      -20,
      "Decision: Resist collapse",
      ctx.currentTurn
    );
    await recordPurgeEvent(ctx.db, ctx.countryId, {
      severity: "extreme",
      kind: "faction",
      reason: "Stage 4: resist collapse",
      turn: ctx.currentTurn,
    });
    await banAllApprovedParties(ctx.db, ctx.countryId);
    await setStage4Delay(ctx.db, ctx.countryId, {
      untilTurn: ctx.currentTurn + RESIST_DELAY_TURNS,
      halveLegacyBonusIfStillBelow15: true,
    });
  },
};

const acceptPeacefully: DecisionOption = {
  id: "acceptPeacefully",
  label: "Accept the conversion peacefully",
  description:
    "Step aside. Marks the regime for system conversion on the next per-turn tick. No intra-party or popular cost — the conversion path itself handles the regime change, snap election, and legacy-seat reservation.",
  async apply(ctx) {
    await setConversionPendingAtTurn(ctx.db, ctx.countryId, ctx.currentTurn);
  },
};

export const stage4FaceCollapseHandler: DecisionHandler = {
  kind: "stage4.faceCollapse",
  options: [resist, acceptPeacefully],
  defaultOptionId: "acceptPeacefully",
};

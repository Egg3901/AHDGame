/**
 * Stage 3 — "Respond to faction split" decision handler.
 *
 * Fires when partyConfidence stays below 15 for 24 turns AND the
 * faction split has spawned a defected party. The decision payload
 * carries `{ defectedPartySequentialId, defectorCount }` from the
 * Stage 3 transition. Four options + an "ignore" default.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Character, ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import type { DecisionHandler, DecisionOption } from "./types";
import { adjustLeaderConfidence, installNewLeader } from "@/lib/turn/rulingPartyConfidence";
import { adjustPopularLegitimacy } from "@/lib/turn/popularLegitimacy";
import { recordPurgeEvent, banApprovedParty } from "@/lib/onePartyState/partyEffectAdapters";
import { resetStage3Dwell } from "@/lib/onePartyState/escalationStateMutators";
import { getCountryState } from "@/lib/countryState";

const negotiate: DecisionOption = {
  id: "negotiate",
  label: "Negotiate (offer power-sharing)",
  description:
    "Bring the defected faction back into the ruling party. Costs intra-party confidence (hardliners read it as weakness) but lifts public mood, re-merges the defectors, and resets the Stage 3 dwell counter.",
  async apply(ctx) {
    const partyId = readDefectedPartyId(ctx.decision.payload);
    if (partyId === null) {
      throw new Error(
        "stage3.respondToFactionSplit.negotiate requires payload.defectedPartySequentialId"
      );
    }
    await adjustLeaderConfidence(
      ctx.db,
      ctx.countryId,
      ctx.leaderCharacterId,
      -4,
      "Decision: Negotiate with defected faction",
      ctx.currentTurn
    );
    await adjustPopularLegitimacy(
      ctx.db,
      ctx.countryId,
      ctx.leaderCharacterId,
      8,
      "Decision: Negotiate with defected faction",
      ctx.currentTurn
    );
    await reMergeDefectors(ctx.db, ctx.countryId, partyId);
    await resetStage3Dwell(ctx.db, ctx.countryId);
  },
};

const purgeDefectors: DecisionOption = {
  id: "purgeDefectors",
  label: "Purge the defectors",
  description:
    "Crush the splinter party. Flips the defected party from `approved` to `banned` and inserts an extreme-severity `faction` purge event. On the next per-turn tick the popular driver reads the purge as repression (significant popular hit, no anti-corruption carve-out) and the intra-party driver reads it as a confidence shock — both bleed in over subsequent turns rather than landing as a single fixed delta. No direct popular benefit; the public sees it as vindictive.",
  async apply(ctx) {
    const partyId = readDefectedPartyId(ctx.decision.payload);
    if (partyId === null) {
      throw new Error(
        "stage3.respondToFactionSplit.purgeDefectors requires payload.defectedPartySequentialId"
      );
    }
    await recordPurgeEvent(ctx.db, ctx.countryId, {
      severity: "extreme",
      kind: "faction",
      reason: "Stage 3: purge defected faction",
      turn: ctx.currentTurn,
    });
    await banApprovedParty(ctx.db, ctx.countryId, partyId);
  },
};

const concedeLeadership: DecisionOption = {
  id: "concedeLeadership",
  label: "Concede leadership",
  description:
    "Step down. The senior defector takes office as the new leader (intra-party confidence resets to 75 on a brand-new leader-state row). The defected party is promoted to ruling and the previously-ruling party demoted to approved. The new leader gets +5 popular and the Stage-3 dwell counter resets to 0. The escalation stage label stays at `internalChallenge` until popular climbs back above 60 — the state machine is forward-only — but Stage-4 collapse cannot fire while the dwell counter is reset and the new leader's intra-party confidence is high.",
  async apply(ctx) {
    const partyId = readDefectedPartyId(ctx.decision.payload);
    if (partyId === null) {
      throw new Error(
        "stage3.respondToFactionSplit.concedeLeadership requires payload.defectedPartySequentialId"
      );
    }

    // Pick the new leader: first character whose party === the defected
    // party's sequentialId. Deterministic so the same payload reliably
    // installs the same successor across re-runs.
    const successor = await ctx.db
      .collection<Character>("characters")
      .findOne({ party: String(partyId), countryId: ctx.countryId });
    if (!successor) {
      throw new Error(
        `concedeLeadership: no character found in defected party ${partyId} for ${ctx.countryId}`
      );
    }

    // Promote the defected party to ruling, demote the prior ruling
    // party to approved. updateCountryState invalidates the cache so
    // subsequent reads see the new rulingPartyId.
    const runtime = await getCountryState(ctx.db, ctx.countryId);
    if (runtime.rulingPartyId !== null) {
      await ctx.db
        .collection<PoliticalParty>("politicalParties")
        .updateOne(
          { sequentialId: runtime.rulingPartyId, countryId: ctx.countryId },
          { $set: { regimeStatus: "approved", updatedAt: new Date() } }
        );
    }
    await ctx.db
      .collection<PoliticalParty>("politicalParties")
      .updateOne(
        { sequentialId: partyId, countryId: ctx.countryId },
        { $set: { regimeStatus: "ruling", updatedAt: new Date() } }
      );
    const { updateCountryState } = await import("@/lib/countryState");
    await updateCountryState(ctx.db, ctx.countryId, { rulingPartyId: partyId });

    // Install the new leader (fresh confidence = 75 via INITIAL_CONFIDENCE).
    await installNewLeader(
      ctx.db,
      ctx.countryId,
      successor._id,
      "premier",
      String(partyId),
      ctx.currentTurn
    );
    // Popular +5 on the NEW leader's state. Apply only after install so
    // the leader-state row exists.
    await adjustPopularLegitimacy(
      ctx.db,
      ctx.countryId,
      successor._id,
      5,
      "Decision: Conceded leadership",
      ctx.currentTurn
    );
    await resetStage3Dwell(ctx.db, ctx.countryId);
  },
};

const ignore: DecisionOption = {
  id: "ignore",
  label: "Ignore",
  description:
    "Take no public action. The Stage 4 dwell counter starts accumulating immediately and the regime slides toward collapse.",
  async apply(_ctx) {
    // No-op — the per-turn driver already accumulates Stage 4 dwell
    // from the internalChallenge stage onward. Decision exists for
    // player clarity (and to clear the queue slot).
  },
};

async function reMergeDefectors(
  db: Db,
  countryId: CountryId,
  defectedPartyId: number
): Promise<void> {
  const runtime = await getCountryState(db, countryId);
  if (runtime.rulingPartyId === null) return;
  const now = new Date();
  // Re-assign every character whose party === defected party back to
  // the ruling party.
  await db
    .collection<Character>("characters")
    .updateMany(
      { countryId, party: String(defectedPartyId) },
      { $set: { party: String(runtime.rulingPartyId), updatedAt: now } }
    );
  await db
    .collection<ElectedOfficial>("electedOfficials")
    .updateMany(
      { countryId, party: String(defectedPartyId) },
      { $set: { party: String(runtime.rulingPartyId) } }
    );
  // Defected party is now empty — flip to banned so it doesn't linger
  // as a ghost approved party with no members.
  await db
    .collection<PoliticalParty>("politicalParties")
    .updateOne(
      { sequentialId: defectedPartyId, countryId },
      { $set: { regimeStatus: "banned", memberCount: 0, updatedAt: now } }
    );
}

function readDefectedPartyId(payload: Record<string, unknown>): number | null {
  const raw = payload["defectedPartySequentialId"];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

export const stage3RespondToFactionSplitHandler: DecisionHandler = {
  kind: "stage3.respondToFactionSplit",
  options: [negotiate, purgeDefectors, concedeLeadership, ignore],
  defaultOptionId: "ignore",
};

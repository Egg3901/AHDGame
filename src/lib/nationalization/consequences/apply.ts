/**
 * Apply the political + market consequences of a taking (spec §12). Replaces the
 * Phase-1 `// TODO(P3)` hooks. Approval is moved via state metrics (there is no
 * stored approval scalar); legitimacy via countryLeaderState.popularLegitimacy
 * for confidence-model countries; confidence via the per-country index. Foreign
 * ownership is recorded + wired only (no relations system exists — spec §12.3).
 */
import type { Db } from "mongodb";
import type { State, PoliticalParty } from "@/lib/db/types";
import type {
  CountryLeaderState,
  LeaderConfidenceHistoryEntry,
} from "@/lib/db/types/countryLeaderState";
import { logWireEvent } from "@/lib/wireEvent";
import { getCountryConfig } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import { readInvestorConfidence, writeInvestorConfidence } from "../investorConfidence";
import { readStateOwnershipConcentration, sociMultiplier } from "../concentration";
import {
  computeConfidenceHit,
  computeApprovalNudge,
  computeLegitimacyDelta,
  computeIdeologyMultiplier,
  classifyTakingPopularity,
  computePrivatizationConfidenceBoost,
  computePrivatizationApprovalNudge,
  computePrivatizationLegitimacyDelta,
} from "./compute";
import { applyLegacyTrustDelta } from "@/lib/sovereignDefault/sideEffects/trustHit";
import type {
  ConsequenceContext,
  ConsequenceResult,
  PrivatizationConsequenceContext,
} from "./types";

export async function applyNationalizationConsequences(
  db: Db,
  ctx: ConsequenceContext
): Promise<ConsequenceResult> {
  const ideologyMultiplier = await resolveIdeologyMultiplier(
    db,
    ctx.countryId,
    ctx.governingPartyId
  );

  // Investor confidence models EXPROPRIATION fear (spec §6.4): it only reacts
  // when a real (player) owner is taken. NPC/unowned takings have no private
  // counterparty, so they incur no confidence/approval/legitimacy hit. Player
  // triggers are anything other than the always-eligible npc/unowned markers.
  const isPrivateExpropriation = ctx.triggers.some((t) => t !== "npc" && t !== "unowned");

  // ── Investor confidence ──────────────────────────────────────────────────
  // Popularity is needed by both the confidence hit (here) and the approval
  // nudge (below), so compute it once. SOCI escalates the hit (Phase 1 index).
  const popularity = classifyTakingPopularity(ctx.triggers);
  const concentration = await readStateOwnershipConcentration(db, ctx.countryId);
  const concentrationMultiplier = sociMultiplier(concentration);

  const before = await readInvestorConfidence(db, ctx.countryId);
  const hit = isPrivateExpropriation
    ? computeConfidenceHit({
        tier: ctx.tier,
        valuationAnchor: ctx.valuationAnchor,
        compensationAnchor: ctx.compensationAnchor,
        ideologyMultiplier,
        concentrationMultiplier,
        popularity,
      })
    : 0;
  const after = Math.max(0, before - hit);
  if (hit > 0) await writeInvestorConfidence(db, ctx.countryId, after, ctx.turn);

  // ── Approval (via state metrics — publicTrust nudge across the country) ────
  const nudge = isPrivateExpropriation
    ? computeApprovalNudge({
        popularity,
        tier: ctx.tier,
        ideologyMultiplier,
        concentrationMultiplier,
      })
    : 0;
  const approvalMetricNudges = await applyPublicTrustNudge(db, ctx.countryId, nudge);

  // ── Legitimacy (confidence-model countries only) ───────────────────────────
  let legitimacyDelta = 0;
  if (isPrivateExpropriation && getCountryConfig(ctx.countryId)?.hasLeaderConfidenceModel) {
    legitimacyDelta = computeLegitimacyDelta({
      tier: ctx.tier,
      ideologyMultiplier,
      concentrationMultiplier,
    });
    await applyLegitimacyDelta(db, ctx.countryId, legitimacyDelta, ctx.turn);
  }

  // ── Foreign owner: record + wire only, no relations delta (spec §12.3). ────
  let foreignOwnerRecorded: ConsequenceResult["foreignOwnerRecorded"] = null;
  if (ctx.foreignOwnerCountryId && ctx.foreignOwnerCountryId !== ctx.countryId) {
    foreignOwnerRecorded = ctx.foreignOwnerCountryId;
    // TODO(diplomacy): bilateral-relations delta + retaliation when a relations
    // system exists. For now we only surface the event below.
  }

  const sectorLabel = ctx.sectorTypes.length > 0 ? ctx.sectorTypes.join("/") : "asset";
  const foreignSuffix = foreignOwnerRecorded ? ` (${foreignOwnerRecorded}-owned)` : "";
  await logWireEvent(
    "corporation_nationalized",
    `${ctx.countryId} nationalized a ${sectorLabel}${foreignSuffix}`
  );

  return {
    confidenceBefore: before,
    confidenceAfter: after,
    legitimacyDelta,
    approvalMetricNudges,
    foreignOwnerRecorded,
  };
}

/** Active regime's governing party id (most-recently-updated leader-state). */
async function resolveActiveGoverningPartyId(db: Db, countryId: CountryId): Promise<string | null> {
  const leader = await db
    .collection<CountryLeaderState>("countryLeaderStates")
    .findOne({ countryId }, { sort: { updatedAt: -1 } });
  return leader?.governingPartyId ?? null;
}

/**
 * Apply the political + market consequences of a completed PRIVATIZATION (spec
 * §12.1) — the mirror of a taking. Privatizing raises investor confidence (a
 * pro-market signal) and applies an ideology-scaled approval + legitimacy effect
 * (market govts rewarded, statist govts pay a cost). The governing party is
 * resolved from the active leader-state. The wire event is emitted by the caller.
 */
export async function applyPrivatizationConsequences(
  db: Db,
  ctx: PrivatizationConsequenceContext
): Promise<ConsequenceResult> {
  const governingPartyId = await resolveActiveGoverningPartyId(db, ctx.countryId);
  const ideologyMultiplier = await resolveIdeologyMultiplier(db, ctx.countryId, governingPartyId);

  const before = await readInvestorConfidence(db, ctx.countryId);
  const after = Math.min(100, before + computePrivatizationConfidenceBoost());
  if (after !== before) await writeInvestorConfidence(db, ctx.countryId, after, ctx.turn);

  const approvalMetricNudges = await applyPublicTrustNudge(
    db,
    ctx.countryId,
    computePrivatizationApprovalNudge(ideologyMultiplier)
  );

  let legitimacyDelta = 0;
  if (getCountryConfig(ctx.countryId)?.hasLeaderConfidenceModel) {
    legitimacyDelta = computePrivatizationLegitimacyDelta(ideologyMultiplier);
    if (Math.abs(legitimacyDelta) > 0.001) {
      await applyLegitimacyDelta(db, ctx.countryId, legitimacyDelta, ctx.turn, "privatization");
    }
  }

  return {
    confidenceBefore: before,
    confidenceAfter: after,
    legitimacyDelta,
    approvalMetricNudges,
    foreignOwnerRecorded: null,
  };
}

/** Nudge governance.publicTrust across every state in the country (clamped). */
async function applyPublicTrustNudge(
  db: Db,
  countryId: CountryId,
  delta: number
): Promise<ConsequenceResult["approvalMetricNudges"]> {
  if (Math.abs(delta) < 0.001) return [];
  // Nationalization's trust consequence goes through the political board's
  // events channel, like the sovereign-default and debt-penalty hits. It used
  // to read the legacy docs and bulk-write them back; no country has those any
  // more, so the read returned nothing and the nudge silently stopped applying.
  await applyLegacyTrustDelta(db, countryId, delta);

  // The reported nudges stay per-region so callers keep their existing shape.
  const states = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1 } })
    .toArray();
  return states.map((s) => ({
    stateId: String(s._id),
    metricPath: "governance.publicTrust",
    delta,
  }));
}

/** Apply a legitimacy delta to the country's seated leader (clamped 0..100). */
async function applyLegitimacyDelta(
  db: Db,
  countryId: CountryId,
  delta: number,
  turn: number,
  reason: string = "nationalization"
): Promise<void> {
  const coll = db.collection<CountryLeaderState>("countryLeaderStates");
  // A country accumulates one leader-state doc per leader over time; target the
  // ACTIVE regime (most-recently-updated), not an arbitrary/stale former leader.
  const leader = await coll.findOne({ countryId }, { sort: { updatedAt: -1 } });
  if (!leader) return;
  const current = leader.popularLegitimacy ?? 75;
  const next = Math.max(0, Math.min(100, current + delta));
  // Mirror src/lib/turn/popularLegitimacy.ts: prepend + slice via $set (the
  // history field is optional, so a $set of the trimmed array is the typed path).
  const entry: LeaderConfidenceHistoryEntry = {
    turn,
    previous: current,
    next,
    delta,
    reason,
    at: new Date(),
  };
  const history = [entry, ...(leader.popularLegitimacyHistory ?? [])].slice(0, 50);
  await coll.updateOne(
    { _id: leader._id },
    { $set: { popularLegitimacy: next, popularLegitimacyHistory: history, updatedAt: new Date() } }
  );
}

/**
 * Resolve the ideology multiplier from the governing party's economic axis.
 * `economicPosition` is on a [-5,+5] scale where negative = left/statist and
 * positive = right/market (verified against politicalParties seeds). Statist
 * governments pay less to nationalize; market-liberal ones pay more. Neutral
 * (1.0) when the party is unknown.
 */
async function resolveIdeologyMultiplier(
  db: Db,
  countryId: CountryId,
  governingPartyId: string | null | undefined
): Promise<number> {
  if (!governingPartyId) return computeIdeologyMultiplier(null);
  const seq = Number(governingPartyId);
  if (!Number.isFinite(seq)) return computeIdeologyMultiplier(null);
  const party = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne({ countryId, sequentialId: seq }, { projection: { economicPosition: 1 } });
  if (!party || typeof party.economicPosition !== "number") return computeIdeologyMultiplier(null);
  return computeIdeologyMultiplier(party.economicPosition / 5); // [-5,5] → [-1,1]
}

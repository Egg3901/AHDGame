/**
 * NPP party-org-building command core (V3 full-agency finance/politics).
 *
 * Lets an autonomous NPP trigger the same Unified Build Org action a player
 * chair/vice-chair/campaigner would, growing the party's state-level Org%
 * by drawing from the unaffiliated pool and poaching rivals — using the
 * EXACT same math core (`calcUnifiedBuildOrg`) and PS-spend command
 * (`spendPoliticalStrength`) the player route
 * (`/api/country/[code]/region/[id]/party/[partyId]/build-org`) uses, so
 * results are indistinguishable from a player click.
 *
 * This exists to fix a real structural bug: `processPartyOrgTurn` applies
 * unconditional Org decay every turn, but growth has only ever come from the
 * player-facing `/build-org` route. NPPs never called it, so over a long run
 * every party's Org decays toward zero with nothing counteracting it — the
 * `NPP_ONLY_STATE_PS_CAP_FRACTION` rationale in strengthConstants.ts even
 * documents NPP-only state parties HOARDING PS to the passive-accrual cap
 * with nothing spending it. This wires the missing spend.
 *
 * Scope constraint vs. the player route: always spends from the STATE PS
 * pool (no national-pool choice), and skips the Priority Region effect
 * bonus and the national-scope PS activity-recovery credit — both are
 * player-choice/tier features that don't apply to a deterministic sweep.
 * Presence, poaching, and ledger bookkeeping all match the player route.
 *
 * The 2026-09-02 treasury cost DOES apply here, from the state treasury at the
 * state rate. Exempting the sweep would let an NPP-run party organise for free
 * the moment it wakes up, which is the whole reason this file exists.
 */

import { ObjectId, type Db } from "mongodb";
import type {
  OrgRegLedger,
  PoliticalParty,
  StatePartyOrg,
  PartyStrengthPressure,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { isNonElectoralUsRegion } from "@/lib/constants/states";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { checkPartyPresence } from "@/lib/turn/partyOrg/presence";
import { ensureStatePartyOrgRow } from "@/lib/turn/partyOrg/ensureStatePartyOrgRow";
import { spendPoliticalStrength } from "@/lib/parties/commands/spendPoliticalStrength";
import {
  BUILD_ORG_BASE_PS_COST,
  blendedComparisonPs,
  effectivePsCost,
} from "@/lib/turn/politicalStrength/strengthConstants";
import {
  clampFundedFraction,
  orgBuildCashPrice,
  resolveOrgBuildFunding,
} from "@/lib/politicalStrength/buildOrgFunding";
import { chargeOrgBuildFunds } from "@/lib/parties/commands/chargeOrgBuildFunds";
import { resolveOrgBuildSizeMultiplier } from "@/lib/politicalStrength/orgBuildStateSize";
import { calcUnifiedBuildOrg } from "@/lib/turn/politicalStrength/buildOrgGain";
import { resolveUnmannedDefaultCaptureMultiplier } from "@/lib/parties/unmannedDefenseShield";

export type NppBuildOrgResult =
  { ok: true; orgGain: number; newOrg: number; psCost: number } | { ok: false; reason: string };

export async function nppBuildPartyOrg(
  db: Db,
  actorNppId: ObjectId,
  countryId: CountryId,
  stateId: string,
  partySequentialId: number,
  currentTurn: number
): Promise<NppBuildOrgResult> {
  const spenderParty = await findPartyBySequentialId(db, partySequentialId, countryId);
  if (!spenderParty) return { ok: false, reason: "Party not found." };

  const partyIdStr = String(spenderParty.sequentialId);
  // Federal districts like DC host no state party organization — skip cleanly
  // so the SSOT chokepoint never throws inside the turn engine.
  if (isNonElectoralUsRegion(countryId, stateId)) {
    return { ok: false, reason: "Federal district has no state party organization." };
  }
  const hasPresence = await checkPartyPresence(db, stateId, partyIdStr);
  if (!hasPresence) return { ok: false, reason: "No presence in this state." };

  let spenderRow = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .findOne({ countryId, stateId, partyId: partyIdStr });
  if (!spenderRow) {
    spenderRow = await ensureStatePartyOrgRow(db, {
      countryId,
      stateId,
      party: spenderParty,
      hasPresence: true,
    });
  }

  const allStateRows = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ countryId, stateId })
    .toArray();

  const totalPartyOrgPct = allStateRows.reduce((s, r) => s + (r.organization ?? 0), 0);
  const rivalRows = allStateRows.filter(
    (r) => r.partyId !== partyIdStr && (r.organization ?? 0) > 0
  );
  const rivalLeadOrgPct = rivalRows.reduce((max, r) => Math.max(max, r.organization ?? 0), 0);

  const rivalParties = rivalRows.length
    ? await db
        .collection<PoliticalParty>("politicalParties")
        .find({ countryId, sequentialId: { $in: rivalRows.map((r) => Number(r.partyId)) } })
        .toArray()
    : [];
  const partyBySeq = new Map(rivalParties.map((p) => [String(p.sequentialId), p]));
  const shieldByPartyId = new Map<string, number>();
  for (const r of rivalRows) {
    const p = partyBySeq.get(r.partyId);
    shieldByPartyId.set(r.partyId, p ? await resolveUnmannedDefaultCaptureMultiplier(db, p) : 1);
  }

  const ownPS = blendedComparisonPs(
    spenderRow.politicalStrength ?? 0,
    spenderParty.politicalStrength ?? 0
  );
  const rivals = rivalRows.map((r) => ({
    partyId: r.partyId,
    orgPct: r.organization ?? 0,
    ps: blendedComparisonPs(
      r.politicalStrength ?? 0,
      partyBySeq.get(r.partyId)?.politicalStrength ?? 0
    ),
    shield: shieldByPartyId.get(r.partyId) ?? 1,
  }));
  const rivalsWithPS = rivals.filter((r) => r.ps > 0);
  const avgRivalPS =
    rivalsWithPS.length > 0 ? rivalsWithPS.reduce((s, r) => s + r.ps, 0) / rivalsWithPS.length : 0;

  const breakdown = calcUnifiedBuildOrg({
    ownOrgPct: spenderRow.organization ?? 0,
    ownPS,
    totalPartyOrgPct,
    rivalLeadOrgPct,
    avgRivalPS,
    rivals,
  });

  if (breakdown.totalGain <= 0) {
    return { ok: false, reason: "Nothing to build — pool empty and no rival Org to poach." };
  }

  const now = new Date();

  // Cash gate — the same one the player route applies. An NPP-run party pays
  // the state rate from its state treasury; without this the sweep would
  // organise for free while players pay. Priced before the PS spend so a
  // refusal costs the party nothing.
  const pressureRow = await db
    .collection<PartyStrengthPressure>("partyStrengthPressure")
    .findOne({ _id: `${countryId}_${partySequentialId}_${stateId}` });
  const sizeMultiplier = await resolveOrgBuildSizeMultiplier(db, countryId, stateId);
  const quotedPrice = orgBuildCashPrice(
    countryId,
    "state",
    effectivePsCost(BUILD_ORG_BASE_PS_COST, pressureRow?.value ?? 0),
    sizeMultiplier
  );
  const funding = resolveOrgBuildFunding({
    price: quotedPrice,
    treasury: spenderRow.treasury ?? 0,
  });
  if (!funding.ok) {
    return { ok: false, reason: "Insufficient state treasury to fund org building." };
  }

  const spendResult = await spendPoliticalStrength(
    {
      countryId,
      partyId: partyIdStr,
      scope: "state",
      stateId,
      baseCost: BUILD_ORG_BASE_PS_COST,
      action: "build-org",
      now,
      turn: currentTurn,
    },
    db
  );
  if (!spendResult.ok) {
    return {
      ok: false,
      reason: spendResult.reason === "insufficient-ps" ? "Insufficient PS." : spendResult.reason,
    };
  }

  // Charge the cash, priced off the PS the spend actually paid. Never
  // overdraws; the realized share scales the gain, floored so committed PS
  // cannot buy nothing.
  const chargePrice = orgBuildCashPrice(
    countryId,
    "state",
    spendResult.effectiveCost,
    sizeMultiplier
  );
  const { charged } = await chargeOrgBuildFunds(
    {
      countryId,
      partyId: partyIdStr,
      scope: "state",
      stateRowId: String(spenderRow._id),
      amount: chargePrice,
      memo: `Build Org (${stateId})`,
      initiatedBy: { type: "system", id: String(actorNppId) },
      turn: currentTurn,
      now,
    },
    db
  );
  const fundedFraction = chargePrice > 0 ? clampFundedFraction(charged / chargePrice) : 1;

  const poolAvailablePct = Math.max(0, 100 - totalPartyOrgPct);
  const appliedPoolGain = Math.min(breakdown.poolGain * fundedFraction, poolAvailablePct);
  const rivalOrgById = new Map(rivalRows.map((r) => [r.partyId, r.organization ?? 0]));
  const appliedPoaches = breakdown.rivalPoaches
    .map((p) => ({
      partyId: p.partyId,
      loss: Math.min(p.loss * fundedFraction, rivalOrgById.get(p.partyId) ?? 0),
    }))
    .filter((p) => p.loss > 0);
  const actualGain = appliedPoolGain + appliedPoaches.reduce((s, p) => s + p.loss, 0);

  const newOwnOrg = Math.round(((spenderRow.organization ?? 0) + actualGain) * 100) / 100;
  await db
    .collection<StatePartyOrg>("statePartyOrg")
    .updateOne({ _id: spenderRow._id }, { $set: { organization: newOwnOrg, updatedAt: now } });

  for (const poach of appliedPoaches) {
    const rivalRow = rivalRows.find((r) => r.partyId === poach.partyId);
    if (!rivalRow) continue;
    const rivalNewOrg =
      Math.round(Math.max(0, (rivalRow.organization ?? 0) - poach.loss) * 100) / 100;
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne({ _id: rivalRow._id }, { $set: { organization: rivalNewOrg, updatedAt: now } });
    await db.collection<OrgRegLedger>("orgRegLedger").insertOne({
      _id: new ObjectId(),
      turn: currentTurn,
      countryId,
      stateId,
      partyId: poach.partyId,
      metric: "org",
      delta: -poach.loss,
      value: rivalNewOrg,
      source: "poach",
      actorId: actorNppId,
      note: `poach:npp-build-org:from:${partyIdStr}`,
      createdAt: now,
    });
  }

  await db.collection<OrgRegLedger>("orgRegLedger").insertOne({
    _id: new ObjectId(),
    turn: currentTurn,
    countryId,
    stateId,
    partyId: partyIdStr,
    metric: "org",
    delta: actualGain,
    value: newOwnOrg,
    source: "action",
    actorId: actorNppId,
    note: "action:npp-build-org",
    createdAt: now,
  });

  return { ok: true, orgGain: actualGain, newOrg: newOwnOrg, psCost: spendResult.effectiveCost };
}

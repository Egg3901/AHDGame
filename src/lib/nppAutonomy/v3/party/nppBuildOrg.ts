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
import { isNonPartyOrganizationUsRegion } from "@/lib/constants/states";
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
import {
  resolveAllOrgBuildSizeMultipliers,
  resolveOrgBuildSizeMultiplier,
} from "@/lib/politicalStrength/orgBuildStateSize";
import { calcUnifiedBuildOrg } from "@/lib/turn/politicalStrength/buildOrgGain";
import { resolveUnmannedDefaultCaptureMultiplier } from "@/lib/parties/unmannedDefenseShield";
import { DEFENSE_UNMANNED_CAPTURE_MULTIPLIER } from "@/lib/turn/partyOrg/defenseConstants";
import type { Character } from "@/lib/db/types";

export type NppBuildOrgResult =
  { ok: true; orgGain: number; newOrg: number; psCost: number } | { ok: false; reason: string };

/**
 * Sweep-level read cache for `nppBuildPartyOrg`. Holds ONLY inputs that are
 * immutable for the duration of the build-org sweep: national party docs
 * (this sweep spends state-scope PS, never national PS, and never reseats
 * chairs), chair-derived capture shields (no chair/user writes on this path),
 * and per-state price multipliers (no population writes on this path).
 *
 * Deliberately NOT cached: state-party organization/PS/treasury rows, PS
 * pressure, and ownership gates; every action re-reads those live because an
 * earlier action in the same sweep may have moved them.
 */
export interface NppBuildOrgSweepCache {
  /** Key `${countryId}:${sequentialId}`. */
  partiesByKey: Map<
    string,
    Pick<
      PoliticalParty,
      "sequentialId" | "countryId" | "politicalStrength" | "isDefault" | "chairId"
    >
  >;
  /** Capture shield per party key, replicating `resolveUnmannedDefaultCaptureMultiplier`. */
  shieldByPartyKey: Map<string, number>;
  /** Price multiplier per `${countryId}:${stateId}`. */
  sizeMultiplierByKey: Map<string, number>;
}

export function partyCacheKey(countryId: CountryId, sequentialId: number | string): string {
  return `${countryId}:${sequentialId}`;
}

function sizeCacheKey(countryId: CountryId, stateId: string): string {
  return `${countryId}:${stateId}`;
}

/**
 * Preload one sweep's worth of immutable build-org inputs. One
 * `politicalParties` scan plus one `characters`/`users` pair for shields plus
 * two `states` reads per country, replacing per-action party lookups, rival
 * `$in` queries, per-rival shield chair/user reads, and per-action state
 * population reads.
 */
export async function preloadNppBuildOrgSweepCache(
  db: Db,
  countryIds: CountryId[]
): Promise<NppBuildOrgSweepCache> {
  const cache: NppBuildOrgSweepCache = {
    partiesByKey: new Map(),
    shieldByPartyKey: new Map(),
    sizeMultiplierByKey: new Map(),
  };
  if (countryIds.length === 0) return cache;

  const partyDocs = await db
    .collection<PoliticalParty>("politicalParties")
    .find(
      { countryId: { $in: countryIds } },
      {
        projection: {
          countryId: 1,
          sequentialId: 1,
          politicalStrength: 1,
          isDefault: 1,
          chairId: 1,
        },
      }
    )
    .toArray();
  for (const p of partyDocs) {
    cache.partiesByKey.set(partyCacheKey(p.countryId as CountryId, p.sequentialId), p);
  }

  // Shields replicate `isActiveHumanChair`: vacant seat, NPP-held (no userId),
  // or banned-user chair reads as unmanned. Bulk the same two lookups with the
  // raw id values (never stringified; `$in` must match ObjectId `_id`s).
  const chairIds: ObjectId[] = [];
  {
    const seen = new Set<string>();
    for (const p of partyDocs) {
      if (!p.isDefault || p.chairId == null) continue;
      const key = String(p.chairId);
      if (seen.has(key)) continue;
      seen.add(key);
      chairIds.push(p.chairId);
    }
  }
  const chairById = new Map<string, Pick<Character, "_id" | "userId">>();
  if (chairIds.length > 0) {
    const chairs = await db
      .collection<Character>("characters")
      .find({ _id: { $in: chairIds } }, { projection: { userId: 1 } })
      .toArray();
    for (const c of chairs) chairById.set(String(c._id), c);
  }
  const userIds: ObjectId[] = [];
  {
    const seen = new Set<string>();
    for (const c of chairById.values()) {
      const userId = (c as { userId?: ObjectId | null }).userId;
      if (userId == null) continue;
      const key = String(userId);
      if (seen.has(key)) continue;
      seen.add(key);
      userIds.push(userId);
    }
  }
  const activeUserIds = new Set<string>();
  if (userIds.length > 0) {
    const users = await db
      .collection("users")
      .find({ _id: { $in: userIds }, isBanned: { $ne: true } }, { projection: { _id: 1 } })
      .toArray();
    for (const u of users) activeUserIds.add(String(u._id));
  }
  for (const p of partyDocs) {
    const key = partyCacheKey(p.countryId as CountryId, p.sequentialId);
    if (!p.isDefault) {
      cache.shieldByPartyKey.set(key, 1);
      continue;
    }
    const chair = p.chairId != null ? chairById.get(String(p.chairId)) : undefined;
    const seated = chair?.userId != null && activeUserIds.has(String(chair.userId));
    cache.shieldByPartyKey.set(key, seated ? 1 : DEFENSE_UNMANNED_CAPTURE_MULTIPLIER);
  }

  for (const cid of countryIds) {
    const multipliers = await resolveAllOrgBuildSizeMultipliers(db, cid);
    for (const [state, mult] of multipliers)
      cache.sizeMultiplierByKey.set(sizeCacheKey(cid, state), mult);
  }
  return cache;
}

export async function nppBuildPartyOrg(
  db: Db,
  actorNppId: ObjectId,
  countryId: CountryId,
  stateId: string,
  partySequentialId: number,
  currentTurn: number,
  sweepCache?: NppBuildOrgSweepCache
): Promise<NppBuildOrgResult> {
  const spenderParty =
    sweepCache?.partiesByKey.get(partyCacheKey(countryId, partySequentialId)) ??
    (await findPartyBySequentialId(db, partySequentialId, countryId));
  if (!spenderParty) return { ok: false, reason: "Party not found." };

  const partyIdStr = String(spenderParty.sequentialId);
  // Reject US regions outside the party-organization jurisdiction set before
  // reaching the SSOT chokepoint. DC is a supported jurisdiction.
  if (isNonPartyOrganizationUsRegion(countryId, stateId)) {
    return { ok: false, reason: "US region does not support a party organization." };
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

  type RivalParty = Pick<
    PoliticalParty,
    "sequentialId" | "politicalStrength" | "isDefault" | "chairId"
  >;
  const partyBySeq = new Map<string, RivalParty>();
  if (sweepCache) {
    for (const r of rivalRows) {
      const hit = sweepCache.partiesByKey.get(partyCacheKey(countryId, r.partyId));
      if (hit) partyBySeq.set(r.partyId, hit);
    }
    // A rival row whose party missed the preload (created mid-sweep) falls
    // back to the same live `$in` read the uncached path uses.
    const missing = rivalRows.filter((r) => !partyBySeq.has(r.partyId));
    if (missing.length > 0) {
      const docs = await db
        .collection<PoliticalParty>("politicalParties")
        .find({ countryId, sequentialId: { $in: missing.map((r) => Number(r.partyId)) } })
        .toArray();
      for (const p of docs) partyBySeq.set(String(p.sequentialId), p);
    }
  } else if (rivalRows.length > 0) {
    const rivalParties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId, sequentialId: { $in: rivalRows.map((r) => Number(r.partyId)) } })
      .toArray();
    for (const p of rivalParties) partyBySeq.set(String(p.sequentialId), p);
  }
  const shieldByPartyId = new Map<string, number>();
  for (const r of rivalRows) {
    const p = partyBySeq.get(r.partyId);
    if (!p) {
      shieldByPartyId.set(r.partyId, 1);
      continue;
    }
    const cached = sweepCache?.shieldByPartyKey.get(partyCacheKey(countryId, r.partyId));
    shieldByPartyId.set(
      r.partyId,
      cached ?? (await resolveUnmannedDefaultCaptureMultiplier(db, p))
    );
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
  const sizeMultiplier =
    sweepCache?.sizeMultiplierByKey.get(sizeCacheKey(countryId, stateId)) ??
    (await resolveOrgBuildSizeMultiplier(db, countryId, stateId));
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
  // Completed receipts flush as ONE `insertMany` in `finally`, in the same
  // poaches-then-own order the per-write `insertOne`s used. Organization
  // mutations stay sequential above; if a rival write throws, the receipts
  // completed before it still persist as with the old per-write inserts.
  // The original write error propagates when the receipt flush succeeds.
  const receipts: OrgRegLedger[] = [];
  try {
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
      receipts.push({
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

    receipts.push({
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
  } finally {
    if (receipts.length > 0) {
      await db.collection<OrgRegLedger>("orgRegLedger").insertMany(receipts);
    }
  }

  return { ok: true, orgGain: actualGain, newOrg: newOwnOrg, psCost: spendResult.effectiveCost };
}

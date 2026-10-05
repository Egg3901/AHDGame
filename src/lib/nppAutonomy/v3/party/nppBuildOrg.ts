/**
 * NPP party-org-building command core (V3 full-agency finance/politics).
 *
 * Lets an autonomous NPP trigger the same Build Org action a player
 * chair/vice-chair/campaigner would, depositing one fixed contribution unit
 * into the party's regional organization bucket and using the same PS command
 * (`spendPoliticalStrength`) the player route
 * (`/api/country/[code]/region/[id]/party/[partyId]/build-org`) uses, so
 * results are indistinguishable from a player click.
 *
 * NPPs use this path so autonomous and player-run parties participate in the
 * same accumulated-investment and inactivity-clock rules.
 *
 * Scope constraint vs. the player route: always spends from the STATE PS
 * pool (no national-pool choice).
 * Presence, bucket derivation, and ledger bookkeeping match the player route.
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
  effectivePsCost,
} from "@/lib/turn/politicalStrength/strengthConstants";
import { orgBuildCashPrice, resolveOrgBuildFunding } from "@/lib/politicalStrength/buildOrgFunding";
import { chargeOrgBuildFunds } from "@/lib/parties/commands/chargeOrgBuildFunds";
import {
  loadOrgBuildLedgerContext,
  type OrgBuildLedgerContext,
} from "@/lib/parties/orgBuildLedger";
import {
  resolveAllOrgBuildSizeMultipliers,
  resolveOrgBuildSizeMultiplier,
} from "@/lib/politicalStrength/orgBuildStateSize";
import { buildOrganizationBucket } from "@/lib/parties/commands/buildOrganizationBucket";

export type NppBuildOrgResult =
  { ok: true; orgGain: number; newOrg: number; psCost: number } | { ok: false; reason: string };

/**
 * Sweep-level read cache for `nppBuildPartyOrg`. Holds ONLY inputs that are
 * immutable for the duration of the build-org sweep: national party docs
 * (this sweep spends state-scope PS, never national PS) and per-state price
 * multipliers (no population writes on this path).
 *
 * Deliberately NOT cached: state-party organization/PS/treasury rows, PS
 * pressure, and ownership gates; every action re-reads those live because an
 * earlier action in the same sweep may have moved them.
 */
export interface NppBuildOrgSweepCache {
  /** Key `${countryId}:${sequentialId}`. */
  partiesByKey: Map<string, Pick<PoliticalParty, "sequentialId" | "countryId">>;
  /** Price multiplier per `${countryId}:${stateId}`. */
  sizeMultiplierByKey: Map<string, number>;
  /** Accounting context for the sweep's treasury charges; absent loads per charge. */
  orgBuildLedger?: OrgBuildLedgerContext | null;
}

export function partyCacheKey(countryId: CountryId, sequentialId: number | string): string {
  return `${countryId}:${sequentialId}`;
}

function sizeCacheKey(countryId: CountryId, stateId: string): string {
  return `${countryId}:${stateId}`;
}

/**
 * Preload one sweep's worth of immutable build-org inputs. One
 * `politicalParties` scan plus two `states` reads per country, replacing
 * per-action party lookups and state population reads.
 */
export async function preloadNppBuildOrgSweepCache(
  db: Db,
  countryIds: CountryId[]
): Promise<NppBuildOrgSweepCache> {
  const cache: NppBuildOrgSweepCache = {
    partiesByKey: new Map(),
    sizeMultiplierByKey: new Map(),
  };
  if (countryIds.length === 0) return cache;
  cache.orgBuildLedger = await loadOrgBuildLedgerContext(db);

  const partyDocs = await db
    .collection<PoliticalParty>("politicalParties")
    .find(
      { countryId: { $in: countryIds } },
      {
        projection: {
          countryId: 1,
          sequentialId: 1,
        },
      }
    )
    .toArray();
  for (const p of partyDocs) {
    cache.partiesByKey.set(partyCacheKey(p.countryId as CountryId, p.sequentialId), p);
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

  // Charge the cash, priced off the PS the spend actually paid. The debit
  // never overdraws, while every successful click deposits the same unit.
  const chargePrice = orgBuildCashPrice(
    countryId,
    "state",
    spendResult.effectiveCost,
    sizeMultiplier
  );
  await chargeOrgBuildFunds(
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
    db,
    sweepCache ? { context: sweepCache.orgBuildLedger } : undefined
  );
  const bucketResult = await buildOrganizationBucket(db, {
    countryId,
    stateId,
    partyId: partyIdStr,
    stateRowId: spenderRow._id,
    currentTurn,
    now,
  });
  if (!bucketResult) return { ok: false, reason: "Organization bucket update failed." };
  const ownResult = bucketResult.rows.find((row) => row.id === spenderRow._id);
  if (!ownResult) return { ok: false, reason: "Organization bucket update failed." };
  const storedById = new Map(bucketResult.sourceRows.map((row) => [row._id, row]));

  const receipts: OrgRegLedger[] = bucketResult.rows
    .filter((row) => row.id === spenderRow._id || Math.abs(row.delta) >= 0.00005)
    .map((row) => {
      const isSpender = row.id === spenderRow._id;
      return {
        _id: new ObjectId(),
        turn: currentTurn,
        countryId,
        stateId,
        partyId: storedById.get(row.id)?.partyId ?? partyIdStr,
        metric: "org",
        delta: row.delta,
        value: row.organization,
        source: isSpender ? "action" : "passive",
        actorId: isSpender ? actorNppId : null,
        note: isSpender ? "action:npp-build-org" : `dilution:npp-build-org:by:${partyIdStr}`,
        createdAt: now,
      };
    });
  if (receipts.length > 0) {
    await db.collection<OrgRegLedger>("orgRegLedger").insertMany(receipts);
  }

  return {
    ok: true,
    orgGain: ownResult.delta,
    newOrg: ownResult.organization,
    psCost: spendResult.effectiveCost,
  };
}

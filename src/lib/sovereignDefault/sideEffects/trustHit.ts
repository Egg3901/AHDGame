/**
 * Apply a cross-country trust delta after a sovereign default.
 *
 * Trust is design-fractional (0..1) but the legacy metric was stored 0..100, so
 * the delta is scaled by 100 before it is converted.
 *
 * BOARD COUNTRIES take the hit on `governance.integrity`, the family
 * `ADAPTER_TIER1` maps `governance.publicTrust` onto. The legacy-unit delta is
 * converted to board points by the same scale conversion the legislation bridge
 * uses, so a given trust hit means the same thing on either side.
 *
 * VALUE, not residual — the distinction matters. A default is an EVENT: it
 * damages trust, and trust recovers. Shifting the value gives exactly that,
 * because the dynamics phase drifts the value back toward its law-implied
 * target each turn — the board's own analogue of the natural decay the legacy
 * `$inc` relied on. Shifting the RESIDUAL instead would move the equilibrium
 * and make a single default permanently redefine how trustworthy the country
 * is, which is what enacted LAW does, not what an event does.
 *
 * The write goes through `applyBoardDelta` rather than a dotted update path;
 * see that module for why the obvious `$inc` silently does nothing.
 *
 * There is no legacy branch: since Phase 3 no country has a `stateMetrics` doc,
 * so a fallback would be dead code pretending to be a safety net.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Filter } from "mongodb";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { boardDeltaForLegacyEffect } from "@/lib/politicalLegislation/legacyEffectBridge";
import { applyBoardDelta } from "@/lib/politicalLegislation/boardWrite";

/**
 * Move public trust by a delta expressed in the LEGACY 0-100 unit.
 *
 * The shared entry point for every "an event damaged (or restored) trust"
 * caller — sovereign default, debt penalties, civil unrest. They all used to
 * `$inc` `governance.publicTrust` on a store no country has any more, so they
 * had all silently become no-ops.
 */
export async function applyLegacyTrustDelta(
  db: Db,
  countryId: CountryId,
  legacyDelta: number
): Promise<{ statesUpdated: number }> {
  const hit = boardDeltaForLegacyEffect("governance", "publicTrust", legacyDelta);
  if (!hit) return { statesUpdated: 0 };
  const { regionsUpdated } = await applyBoardDelta(
    db,
    { countryId } as Filter<PoliticalMetricsDoc>,
    hit.familyId,
    hit.scoreDelta,
    "value"
  );
  return { statesUpdated: regionsUpdated };
}

/** Sovereign-default entry point: trust is design-fractional (0..1) there. */
export async function applyCrossCountryTrustHit(
  db: Db,
  countryId: CountryId,
  fractionalDelta: number
): Promise<{ statesUpdated: number }> {
  return applyLegacyTrustDelta(db, countryId, fractionalDelta * 100);
}

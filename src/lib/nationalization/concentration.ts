/**
 * State Ownership Concentration Index (SOCI, spec rebalance 2026-06-24). A
 * per-country 0–100 measure = state-owned corporate revenue ÷ total national
 * corporate revenue. Stored on the FederalBudget doc, recomputed each turn. The
 * shared `sociMultiplier` turns it into the escalation factor every
 * nationalization cost channel multiplies by. (Named `soci*` to avoid collision
 * with the unrelated `concentrationMultiplier` in `@/lib/economicModels`.)
 */
import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector, FederalBudget } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  loadFxRatesByCurrency,
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { SOCI_DANGER_ZONE, CONCENTRATION_MULTIPLIER_MAX } from "./constants";

/** Clamp any value into the SOCI range [0,100]; non-finite ⇒ 0. */
export function clampConcentration(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/** SOCI from two ₳-anchor revenue sums. 0 when there is no corporate revenue. */
export function computeStateOwnershipConcentration(input: {
  stateRevenueAnchor: number;
  totalRevenueAnchor: number;
}): number {
  const total = input.totalRevenueAnchor;
  if (!(total > 0)) return 0;
  return clampConcentration((100 * input.stateRevenueAnchor) / total);
}

/**
 * Escalation multiplier (≥ 1.0). Exactly 1.0 at/below the danger zone, then a
 * convex (quadratic) ramp to CONCENTRATION_MULTIPLIER_MAX at SOCI 100 — early
 * takings barely escalate, empire-building bites hard.
 */
export function sociMultiplier(soci: number): number {
  const s = clampConcentration(soci);
  if (s <= SOCI_DANGER_ZONE) return 1;
  const span = 100 - SOCI_DANGER_ZONE;
  const t = (s - SOCI_DANGER_ZONE) / span; // 0..1 past the knee
  return 1 + (CONCENTRATION_MULTIPLIER_MAX - 1) * t * t;
}

/** Read a country's stored SOCI, clamped; absent ⇒ 0. */
export async function readStateOwnershipConcentration(
  db: Db,
  countryId: CountryId
): Promise<number> {
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId }, { projection: { stateOwnershipConcentration: 1 } });
  const raw = budget?.stateOwnershipConcentration;
  return typeof raw === "number" ? clampConcentration(raw) : 0;
}

/** Persist a country's SOCI (clamped) and stamp the turn it was computed. */
export async function writeStateOwnershipConcentration(
  db: Db,
  countryId: CountryId,
  value: number,
  turn: number
): Promise<void> {
  await db.collection<FederalBudget>("federalBudget").updateOne(
    { countryId },
    {
      $set: {
        stateOwnershipConcentration: clampConcentration(value),
        stateOwnershipConcentrationUpdatedAtTurn: turn,
      },
    }
  );
}

/**
 * Live SOCI for a country: sums every `corporateSectors.revenue` whose sector
 * operates in the country, normalized to ₳ via the owning corp's FX rate. The
 * numerator is the subset owned by THIS country's state (`countryOwnerId ===
 * countryId`) — a foreign state's NatCorp operating here counts as ordinary
 * corporate revenue in the denominator, not toward this country's concentration.
 * `fxByCurrency` may be supplied by a batch caller (the turn phase) to avoid
 * re-loading FX per country.
 */
export async function computeCountryStateOwnershipConcentration(
  db: Db,
  countryId: CountryId,
  fxByCurrency?: ReadonlyMap<CurrencyCode, number>
): Promise<number> {
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ countryId })
    .project<{ corporationId: ObjectId; revenue: number }>({ corporationId: 1, revenue: 1 })
    .toArray();
  if (sectors.length === 0) return 0;

  const uniqueCorpIds = Array.from(
    new Map(sectors.map((s) => [s.corporationId.toString(), s.corporationId])).values()
  );
  const [corps, fx] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: uniqueCorpIds } })
      .toArray(),
    fxByCurrency ? Promise.resolve(fxByCurrency) : loadFxRatesByCurrency(db),
  ]);
  const corpById = new Map(corps.map((c) => [c._id.toString(), c]));

  let totalRevenueAnchor = 0;
  let stateRevenueAnchor = 0;
  for (const sector of sectors) {
    const corp = corpById.get(sector.corporationId.toString());
    if (!corp) continue;
    const code = resolveCorpLiquidCurrencyCode(corp);
    const rate = fxRateForCorpFromMap(corp, fx);
    const revenueAnchor = readCorpEconomicAnchor(sector.revenue, code, rate);
    totalRevenueAnchor += revenueAnchor;
    if (corp.countryOwnerId === countryId) stateRevenueAnchor += revenueAnchor;
  }

  return computeStateOwnershipConcentration({ stateRevenueAnchor, totalRevenueAnchor });
}

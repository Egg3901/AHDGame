import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Bond, CentralBank, Character, Corporation, CorporateSector } from "@/lib/db/types";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  loadFxRatesByCurrency,
  resolveSectorHostCurrencyCode,
  fxRateForSectorHostFromMap,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  unownedHeadroomUnitsPerAnchor,
  unownedPoolCreditBaseExpr,
  unownedPoolLeadingField,
  unownedPoolTrailingSet,
} from "@/lib/market/unownedHeadroom";
import { revenuePerCapacityUnitForStrategy } from "@/lib/constants/capacityEconomy";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildPersonalBalanceInc, getHomeCurrency } from "@/lib/currency/characterFunds";
import { writeGovBudgetLocal } from "@/lib/currency/govBudgetFields";
import { sumBondPrincipalAnchor } from "@/lib/bonds/bondPrincipalSum";
import {
  allocateShareholderPool,
  buildPrimeRateMap,
  computeSectorNpvSum,
} from "@/lib/bonds/corporateBondDefault";
import { cleanupShareMarketActivityForCorporations } from "@/lib/corporations/cleanupShareMarketActivity";
import { payFundShareholderRows } from "@/lib/corporations/payFundShareholders";
import { applyBrandFacilityLoss } from "@/lib/corporations/brandFacilityLoss";
import { stampSubjectDeleted } from "@/lib/financialTxLog/stampDeleted";
import type { CountryId } from "@/lib/constants/countries";
import {
  ensurePrimaryNationalCorporation,
  resolveNationalCorporationForSector,
} from "./nationalCorporation";
import {
  applyTier,
  computeWholeCorpValuation,
  sectorCompensationValuationAnchor,
  wholeCorpCompensationAnchor,
} from "./compensation";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import {
  mergeSectorPlantFields,
  readSectorPlantFields,
} from "@/lib/corporations/sectorTransferCapex";
import { getGameState } from "@/lib/gameState";
import { sumSectorBookValueAnchor } from "@/lib/corporations/sectorProfitBasis";
import { readStateOwnershipConcentration, sociMultiplier } from "./concentration";
import { creditTreasuryProceeds, debitTreasuryCompensation } from "./treasury";
import type { CompensationTier } from "./constants";
import { NATIONALIZATION_REVENUE_HAIRCUT } from "./constants";
import { applyNationalizationConsequences } from "./consequences/apply";
import { recordNationalizationLedger } from "./ledger";
import type { NationalizationMethod, NationalizationTrigger } from "./consequences/types";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

/**
 * Politics inputs the caller supplies; the money fields (valuation, compensation,
 * foreign-owner) are computed by the transition itself and merged in.
 */
export interface TransitionConsequenceInput {
  method: NationalizationMethod;
  triggers: NationalizationTrigger[];
  turn: number;
  governingPartyId?: string | null;
  actorCharacterId?: ObjectId;
}

/**
 * Move one seized `sector` into the National Corporation `destId`, MERGING into
 * the NatCorp's existing holding of the same `(stateId, sectorType)` when one
 * exists — a blind `$set: { corporationId }` would violate the unique
 * `(corporationId, stateId, sectorType)` index and throw E11000 (e.g. a second
 * `tech@Beijing` taking after the NatCorp already holds `tech@Beijing`). On a
 * merge the donor row's capacity is folded into the existing row and the donor
 * row is dropped; otherwise the donor row is simply re-parented. Mirrors
 * `nationalizeSectorWide.addToNatCorp`.
 *
 * PLANTS-GATED: under `marketSystemMode >= "plants"` a corporate sector's
 * `revenue` is DERIVED — `sectorTurn` restates it from `capitalStock × mix
 * price` every turn — so a taking that moved value through `revenue` alone
 * would be erased on the next tick. Both branches therefore move CAPACITY under
 * plants, and both apply the 15% transition haircut to `capitalStock` (the
 * capacity leg), which is the quantity the restatement reads. The revenue write
 * is kept in lockstep off the same haircut so the two views cannot diverge in
 * the turn before `sectorTurn` next restates them. Below plants `plantsEnabled`
 * is false, no plant field is written, and every write here is byte-identical to
 * the pre-fix behaviour — which matters because below plants `capitalStock` is
 * owned and re-derived by capital mode, and spreading a fold would also stamp
 * `buildQueue: []` / `constructionInProgressAnchor: 0` / `mothballed: false` /
 * `plantsStartTurn: null` onto rows that legitimately carry none of them.
 */
async function absorbSectorIntoNatCorp(
  db: Db,
  sector: CorporateSector,
  destId: ObjectId,
  absorbedAtTurn: number,
  now: Date,
  transitionMultiplier: number,
  plantsEnabled: boolean
): Promise<void> {
  const sectors = db.collection<CorporateSector>("corporateSectors");
  // Transition revenue haircut: the state acquires a disrupted asset worth 15%
  // less than what the former owner held (compensation is paid on the full value
  // upstream, before this transfer). nationalizedAtTurn anchors the productivity
  // shock that decays over NATIONALIZATION_TRANSITION_TURNS.
  const keep = 1 - NATIONALIZATION_REVENUE_HAIRCUT;
  const transferRevenue = Math.round((sector.revenue ?? 0) * keep);
  const donorStock =
    typeof sector.capitalStock === "number" && Number.isFinite(sector.capitalStock)
      ? Math.max(0, sector.capitalStock)
      : 0;
  // The haircut lands on `capitalStock` and on `capitalStock` ONLY — the same
  // rule `nationalizeSectorWide` carves by. `constructionInProgressAnchor` and
  // each build order's `costPaidAnchor` are real ₳ a corp has ALREADY PAID:
  // shaving 15% off them destroys money rather than capacity and breaks the
  // invariant that a sector's CIP equals Σ of its own queue. In-flight builds
  // therefore transfer whole — the state seizes a going concern, and the
  // compensation paid upstream already prices CIP in (D11 replacement-cost book).
  const haircutStock = Math.round(donorStock * keep * 100) / 100;
  // P5: the paid basis follows the capacity, at the same haircut, so the
  // per-unit basis of the surviving plant is unchanged. Only touched when the
  // donor carries a recorded basis — a row without one keeps the list-price
  // fallback, which already tracks the haircut stock automatically.
  const donorBook =
    typeof sector.capacityBookAnchor === "number" &&
    Number.isFinite(sector.capacityBookAnchor) &&
    sector.capacityBookAnchor >= 0
      ? sector.capacityBookAnchor
      : null;
  const haircutBook = donorBook != null ? donorBook * keep : null;
  const existing = await sectors.findOne({
    corporationId: destId,
    stateId: sector.stateId,
    sectorType: sector.sectorType,
  });
  if (existing && !existing._id.equals(sector._id)) {
    // MERGE: the donor row is DELETED below, so anything not folded into the
    // survivor here is destroyed outright. `mergeSectorPlantFields` sums
    // capacity and CIP, concatenates the queues in landing order, ANDs
    // `mothballed` and keeps the EARLIER ramp anchor (a re-anchored ramp would
    // re-clamp production the donor had long since ramped past).
    const merged = plantsEnabled
      ? mergeSectorPlantFields(readSectorPlantFields(existing), {
          ...readSectorPlantFields(sector),
          capitalStock: haircutStock,
          capacityBookAnchor: haircutBook,
        })
      : null;
    await sectors.updateOne(
      { _id: existing._id },
      {
        $inc: {
          // Revenue merges in EVERY mode, in lockstep with the capacity fold
          // above and off the same post-haircut quantity — the rule
          // `nationalizeSectorWide.addToNatCorp` already carves by.
          //
          // This used to be skipped under plants on the reasoning that the
          // survivor's revenue is restated from the folded `capitalStock` next
          // tick anyway, so adding the donor's revenue would double-count its
          // capacity for one turn. That reasoning is backwards: the donor row is
          // DELETED immediately below, so skipping the write does not avoid a
          // double count, it creates a hole. For the turn between this taking
          // and the next `sectorTurn` restatement the donor's revenue exists
          // nowhere in the world, and both the metric-engine provider and
          // `estimateNationalizedOperatingIncome` read exactly that field. The
          // result was a one-turn UNDERCOUNT of national output, not a saving.
          revenue: transferRevenue,
          workers: sector.workers ?? 0,
          currentGrowthCost: sector.currentGrowthCost ?? 0,
        },
        $set: {
          ...(merged
            ? {
                ...merged,
                constructionInProgressAnchor: Math.round(merged.constructionInProgressAnchor),
              }
            : {}),
          absorbedAtTurn,
          nationalizedAtTurn: absorbedAtTurn,
          nationalizationTransitionMultiplier: transitionMultiplier,
          updatedAt: now,
        },
      }
    );
    await sectors.deleteOne({ _id: sector._id });
  } else {
    // RE-PARENT: the doc itself is re-pointed, so the plant state rides along
    // for free — except `capitalStock`, which must take the haircut. Without it
    // the next tick restates `revenue` from the untouched nameplate straight
    // back to the full pre-taking figure and the transition penalty silently
    // evaporates.
    await sectors.updateOne(
      { _id: sector._id },
      {
        $set: {
          corporationId: destId,
          revenue: transferRevenue,
          ...(plantsEnabled ? { capitalStock: haircutStock } : {}),
          ...(plantsEnabled && haircutBook != null ? { capacityBookAnchor: haircutBook } : {}),
          absorbedAtTurn,
          nationalizedAtTurn: absorbedAtTurn,
          nationalizationTransitionMultiplier: transitionMultiplier,
          updatedAt: now,
        },
      }
    );
  }
}

/**
 * Release one FOREIGN sector (held outside the nationalizing country) to the open
 * unowned market: a country cannot hold assets under another jurisdiction, so a
 * whole-corp taking divests them rather than absorbing them into the domestic
 * National Corporation. The sector revenue (the donor's local currency) is
 * converted to the ₳-native unowned unit and merged into the `(stateId,
 * sectorType)` unowned pool (upsert + `$inc`); the donor row is then removed.
 * No transition haircut — the asset is released to the market, not operated by
 * the state. Mirrors the shed path's CorporateSector→unowned conversion.
 */
async function releaseSectorToUnowned(
  db: Db,
  sector: CorporateSector,
  currencyCode: CurrencyCode | string | undefined,
  fxRate: number,
  now: Date,
  plantsEnabled: boolean,
  eraUnitScale: number
): Promise<void> {
  // PLANTS RETURNS CAPACITY, NOT FILL-DEPENDENT REVENUE.
  //
  // Same rule `restoreSectorsToUnowned` applies on the abandon/dissolution path,
  // and for the same reason twice over. (1) Under plants `revenue` is what the
  // market actually cleared against the plant, so a sector running at 40%
  // utilization would hand the pool 40% of the market it was occupying and the
  // other 60% would simply cease to exist. (2) A MOTHBALLED sector reports
  // revenue 0 with its capital stock fully intact — the old `revenueAnchor > 0`
  // gate skipped the pool write entirely and then fell through to the
  // unconditional `deleteOne` below, so the state paid replacement-cost book
  // compensation for a plant that it then deleted from the world.
  //
  // Under plants the released quantity is therefore the sector's CAPACITY —
  // built stock plus undelivered build orders, priced through the sector's OWN
  // strategy mix into the pool's default-mix units, exactly as
  // `restoreSectorsToUnowned` does it so the two release paths cannot disagree.
  // Both legs are ₳-native, so no FX enters the capacity leg.
  //
  // Below plants `plantsEnabled` is false and every line here is byte-identical
  // to the previous behaviour: the ₳ revenue leg, gated on `revenueAnchor > 0`.
  const stock =
    typeof sector.capitalStock === "number" && Number.isFinite(sector.capitalStock)
      ? Math.max(0, sector.capitalStock)
      : 0;
  const queuedUnits = plantsEnabled
    ? (Array.isArray(sector.buildQueue) ? sector.buildQueue : []).reduce(
        (sum, order) =>
          sum +
          (order != null && Number.isFinite(order.unitsOrdered) && order.unitsOrdered > 0
            ? order.unitsOrdered
            : 0),
        0
      )
    : 0;
  const capacityAnchor = plantsEnabled
    ? Math.max(
        0,
        Math.round(
          (stock + queuedUnits) *
            revenuePerCapacityUnitForStrategy(
              sector.sectorType as CorporationType,
              sector.strategyId,
              eraUnitScale
            )
        )
      )
    : 0;
  const revenueAnchor = plantsEnabled
    ? capacityAnchor
    : Math.max(0, Math.round(readCorpEconomicAnchor(sector.revenue ?? 0, currencyCode, fxRate)));
  if (revenueAnchor > 0) {
    // Pipeline update (not $inc + $setOnInsert): `headroomUnits` is DERIVED
    // from revenue and must be recomputed from the POST-increment figure in the
    // same write, or the pool's plants-mode denominator keeps describing the
    // revenue it held before this release. $inc on headroomUnits would not do:
    // on a doc predating the backfill the field is absent, so $inc would start
    // it from 0 and understate the pool permanently. Deriving from the new
    // total is self-healing either way. $setOnInsert is unavailable inside a
    // pipeline, hence the $ifNull identity seeding (same shape as
    // restoreSectorsToUnowned).
    // TIER-AWARE LEADING LEG. This used to add `revenueAnchor` to `revenue`
    // unconditionally and then restate `headroomUnits` from the new revenue
    // total — the below-plants direction, run in both tiers. Under plants that
    // was wrong twice: it led with the leg nothing authoritative reads, and the
    // restatement rebuilt the unit pool from a revenue figure that still carried
    // demand already drawn down (drawdowns clamp `headroomUnits` at 0 without
    // pushing the clamp back into `revenue` proportionally), so every foreign
    // release RESURRECTED headroom the market had already consumed.
    //
    // Now it credits whichever leg leads for the tier and lets
    // `unownedPoolTrailingSet` restate the other — identical in shape to
    // `restoreSectorsToUnowned`, which is the whole point: the two release paths
    // cannot disagree because they no longer each spell the write out.
    const unitsPerAnchor = unownedHeadroomUnitsPerAnchor(
      sector.sectorType as CorporationType,
      eraUnitScale
    );
    const sectorType = sector.sectorType as CorporationType;
    const creditField = unownedPoolLeadingField(plantsEnabled);
    // The delta in the leading leg's own units. `revenueAnchor` is ₳ either way;
    // under plants it converts through the pool's default mix, the same
    // conversion `restoreSectorsToUnowned` applies to its capacity leg.
    const creditAmount = plantsEnabled ? revenueAnchor * unitsPerAnchor : revenueAnchor;
    await db.collection<UnownedSector>("unownedSectors").updateOne(
      { stateId: sector.stateId, sectorType: sector.sectorType },
      [
        {
          $set: {
            _id: { $ifNull: ["$_id", new ObjectId()] },
            stateId: { $ifNull: ["$stateId", sector.stateId] },
            countryId: { $ifNull: ["$countryId", sector.countryId] },
            sectorType: { $ifNull: ["$sectorType", sector.sectorType] },
            createdAt: { $ifNull: ["$createdAt", now] },
            [creditField]: {
              $add: [
                unownedPoolCreditBaseExpr(sectorType, plantsEnabled, eraUnitScale),
                creditAmount,
              ],
            },
            updatedAt: now,
          },
        },
        { $set: unownedPoolTrailingSet(sectorType, plantsEnabled, eraUnitScale) },
      ],
      { upsert: true }
    );
  }
  await db.collection<CorporateSector>("corporateSectors").deleteOne({ _id: sector._id });
}

// ── Single-sector absorption ──────────────────────────────────────────────────

export interface NationalizeSectorParams {
  countryId: CountryId;
  sectorId: ObjectId;
  tier: CompensationTier;
  consequence: TransitionConsequenceInput;
}

export interface NationalizeSectorResult {
  nationalCorporationId: ObjectId;
  /** Compensation credited to the donor's liquid capital, in the donor's currency. */
  compensationPaid: number;
}

/**
 * Single-sector nationalization: move one (stateId, sectorType) sector into the
 * country's National Corporation; the donor corp survives and is paid
 * `sectorNPV × tier` into its liquid capital.
 *
 * Valuation reuses the canonical `computeSectorNpvSum` (the same going-concern
 * NPV used by corporate-bond-default dissolution + issuance), so the sector is
 * valued identically everywhere. That helper returns ₳ (anchor); the payout is
 * converted back to the donor's currency at the persistence boundary.
 */
export async function nationalizeSector(
  db: Db,
  params: NationalizeSectorParams
): Promise<NationalizeSectorResult> {
  const now = new Date();
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const corps = db.collection<Corporation>("corporations");

  const sector = await sectors.findOne({ _id: params.sectorId });
  if (!sector) throw new Error("Sector not found");

  const donor = await corps.findOne({ _id: sector.corporationId });
  if (!donor) throw new Error("Donor corporation not found");

  // Route to the NatCorp that owns this sector type (split-off if one claims it,
  // else the primary). Future takings of a split-off type land in the right corp.
  const nationalCorp = await resolveNationalCorporationForSector(
    db,
    params.countryId,
    sector.sectorType
  );

  // Valuation in ₳ via the canonical sector NPV (going-concern, growth-cost-net).
  const [centralBanks, fxByCurrency, donorFxRate, marketMode, gameState] = await Promise.all([
    db.collection<CentralBank>("centralBanks").find({}).toArray(),
    loadFxRatesByCurrency(db),
    getCorpFxRate(db, donor),
    getMarketSystemModeForDb(db),
    getGameState(db),
  ]);
  const plantsEnabled = marketAtLeast(marketMode, "plants");
  const primeMap = buildPrimeRateMap(centralBanks);
  // Nationalization pays on steady-state earning power (revenue − maintenance),
  // not the growth-cost-net going-concern NPV — a sector the owner is actively
  // growing must not value to €0 just because its discretionary growth spending
  // consumes its current profit (Bug #0775 follow-up).
  //
  // D11: under plants the base switches to replacement-cost book (and the
  // premium inside applyTier switches with it).
  const valuationAnchor = sectorCompensationValuationAnchor(
    sector,
    computeSectorNpvSum([sector], primeMap, donor, fxByCurrency, {
      excludeGrowthCost: true,
      plantsEnabled,
    }),
    {
      plantsEnabled,
      currentYear: gameState?.currentYear,
      eraUnitScale: await loadWorldEraUnitScale(db),
    }
  );
  const payoutAnchor = applyTier(valuationAnchor, params.tier, { plantsEnabled });

  // Debit the treasury BEFORE any mutation. The debit is unconditional — an
  // unaffordable payout pushes the treasury into the hole rather than blocking
  // the taking. Seizure (0 payout) moves nothing.
  await debitTreasuryCompensation(db, params.countryId, payoutAnchor, fxByCurrency, now);

  // Snapshot the SOCI escalation multiplier at taking time so the transition
  // shock is fixed to today's concentration, not retroactively deepened later.
  const transitionMultiplier = sociMultiplier(
    await readStateOwnershipConcentration(db, params.countryId)
  );

  // Move the sector into the National Corporation, merging into an existing
  // (NatCorp, state, type) holding when present. Stamp the absorption turn so the
  // re-privatization cooldown (spec §13.4) can protect just-absorbed assets.
  // Brand facility-loss (Boeing rule): the donor survives a single-sector taking
  // but loses this plant to the state, so dent its brand proportional to the
  // sector's share of its revenue. Called before the sector is re-parented (the
  // aggregate still includes it). No-op when the donor has no loyalty.
  await applyBrandFacilityLoss(db, donor._id, sector.revenue);

  await absorbSectorIntoNatCorp(
    db,
    sector,
    nationalCorp._id,
    params.consequence.turn,
    now,
    transitionMultiplier,
    plantsEnabled
  );

  // Credit the donor in its own currency (counterparty of the treasury debit).
  let compensationPaid = 0;
  if (payoutAnchor > 0) {
    compensationPaid = Math.round(anchorToCorpLiquidCapital(payoutAnchor, donor, donorFxRate));
    await corps.updateOne(
      { _id: donor._id },
      { $inc: { liquidCapital: compensationPaid }, $set: { updatedAt: now } }
    );
  }

  // Politics + investor-confidence (spec §12). Compensation here is in ₳ already.
  const consequenceResult = await applyNationalizationConsequences(db, {
    countryId: params.countryId,
    method: params.consequence.method,
    tier: params.tier,
    triggers: params.consequence.triggers,
    sectorTypes: [sector.sectorType],
    valuationAnchor,
    compensationAnchor: payoutAnchor,
    foreignOwnerCountryId: donor.countryId !== params.countryId ? donor.countryId : null,
    governingPartyId: params.consequence.governingPartyId ?? null,
    turn: params.consequence.turn,
    actorCharacterId: params.consequence.actorCharacterId,
  });

  // Acquisition ledger (Register tab). Best-effort — a failed write never aborts.
  try {
    await recordNationalizationLedger(db, {
      countryId: params.countryId,
      nationalCorporationId: nationalCorp._id,
      kind: "nationalize_sector",
      method: params.consequence.method,
      triggers: params.consequence.triggers,
      tier: params.tier,
      valuationAnchor,
      compensationAnchor: payoutAnchor,
      sectorTypes: [sector.sectorType],
      formerCorpName: donor.name,
      foreignOwnerCountryId: donor.countryId !== params.countryId ? donor.countryId : null,
      confidenceBefore: consequenceResult.confidenceBefore,
      confidenceAfter: consequenceResult.confidenceAfter,
      legitimacyDelta: consequenceResult.legitimacyDelta,
      turn: params.consequence.turn,
    });
  } catch (err) {
    console.error("[nationalizationLedger] sector ledger write failed:", err);
  }

  return { nationalCorporationId: nationalCorp._id, compensationPaid };
}

// ── Whole-corp absorption ─────────────────────────────────────────────────────

export interface NationalizeWholeCorpParams {
  countryId: CountryId;
  corporationId: ObjectId;
  tier: CompensationTier;
  consequence: TransitionConsequenceInput;
}

export interface NationalizeWholeCorpResult {
  nationalCorporationId: ObjectId;
  sectorsAbsorbed: number;
  bondsAssumed: number;
  /** Total shareholder compensation paid out, in ₳. */
  shareholderPayoutAnchor: number;
}

/**
 * Whole-corp absorption (central model): pay shareholders pro-rata at
 * `valuation × tier`, move every sector into the country's National Corporation,
 * re-stamp the seized corp's issued bonds to the National Corporation (the state
 * assumes the debt — coupons keep paying, no default), then dissolve the seized
 * shell. Valuation inputs are captured BEFORE anything moves.
 */
export async function nationalizeWholeCorp(
  db: Db,
  params: NationalizeWholeCorpParams
): Promise<NationalizeWholeCorpResult> {
  const now = new Date();
  const corps = db.collection<Corporation>("corporations");
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const bonds = db.collection<Bond>("bonds");

  const target = await corps.findOne({ _id: params.corporationId });
  if (!target) throw new Error("Target corporation not found");
  if (target.countryOwnerId || target.ownershipState === "stateOwned") {
    throw new Error("Cannot nationalize a state-owned corporation");
  }

  // The primary NatCorp is the bond-assumption target + the canonical return.
  // Individual sectors may route to split-offs (resolved per type below).
  const nationalCorp = await ensurePrimaryNationalCorporation(db, params.countryId);

  // ── 1. Capture valuation inputs BEFORE moving sectors/bonds (₳). ──
  const [
    targetSectors,
    targetBonds,
    centralBanks,
    fxByCurrency,
    targetFxRate,
    marketMode,
    corpGameState,
  ] = await Promise.all([
    sectors.find({ corporationId: target._id }).toArray(),
    bonds.find({ corporationId: target._id, matured: false }).toArray(),
    db.collection<CentralBank>("centralBanks").find({}).toArray(),
    loadFxRatesByCurrency(db),
    getCorpFxRate(db, target),
    getMarketSystemModeForDb(db),
    getGameState(db),
  ]);
  const corpPlantsEnabled = marketAtLeast(marketMode, "plants");
  const corpEraUnitScale = await loadWorldEraUnitScale(db);
  const primeMap = buildPrimeRateMap(centralBanks);
  // Steady-state valuation for the whole-corp payout — see nationalizeSector.
  // D11: under plants the sector leg of balance-sheet equity is replacement-cost
  // book, not capitalized earnings.
  const sectorNpvAnchor = corpPlantsEnabled
    ? sumSectorBookValueAnchor(targetSectors, corpGameState?.currentYear, corpEraUnitScale)
    : computeSectorNpvSum(targetSectors, primeMap, target, fxByCurrency, {
        excludeGrowthCost: true,
      });
  const liquidCapitalAnchor = corpLiquidCapitalToAnchor(target.liquidCapital, target, targetFxRate);
  // Debt the state assumes — sum of the corp's issued, non-matured bond principal.
  const debtAnchor = sumBondPrincipalAnchor(targetBonds, fxByCurrency);
  // Held bonds + cross-corp equity are not added to equity in Phase 1 (conservative
  // under-valuation, never an over-pay); fold them in with the portfolio pass (P5+).
  const sharePriceAnchor = corpLiquidCapitalToAnchor(target.sharePrice, target, targetFxRate);
  // D11 — base and premium must move together. Under plants the sector leg is
  // replacement-cost book and carries the BOOK premium; cash is taken at par
  // (paying a premium on cash mints money); debt nets off cash first. Pre-fix,
  // `computeWholeCorpValuation`'s max(marketCap, equity) could hand a MARKET
  // base to `applyTier`'s BOOK premium — see `wholeCorpCompensationAnchor`.
  // Below plants the original market-cap-floored path is untouched.
  let valuationAnchor: number;
  let payoutPoolAnchor: number;
  if (corpPlantsEnabled) {
    const comp = wholeCorpCompensationAnchor({
      sectorBookAnchor: sectorNpvAnchor,
      nonSectorAssetsAnchor: liquidCapitalAnchor,
      debtAnchor,
      tier: params.tier,
    });
    valuationAnchor = comp.valuationAnchor;
    payoutPoolAnchor = comp.payoutAnchor;
  } else {
    valuationAnchor = computeWholeCorpValuation({
      sharePrice: sharePriceAnchor,
      totalShares: target.totalShares,
      balanceSheetEquity: liquidCapitalAnchor + sectorNpvAnchor,
      debt: debtAnchor,
    });
    payoutPoolAnchor = applyTier(valuationAnchor, params.tier);
  }

  // ── 2. Debit the treasury BEFORE any mutation. Unconditional — an unaffordable
  //       taking deepens the treasury's debt rather than being blocked. ──
  await debitTreasuryCompensation(db, params.countryId, payoutPoolAnchor, fxByCurrency, now);

  // ── 3. Pay shareholders pro-rata (counterparty of the treasury debit). ──
  if (payoutPoolAnchor > 0) {
    await payShareholders(db, target, payoutPoolAnchor, fxByCurrency, now);
  }

  // ── 3b. Settle the dissolved corp's liquid cash (Bug #0775). The shell is
  //       deleted below, so its `liquidCapital` must be distributed rather than
  //       silently destroyed. The state recoups the cash up to the compensation
  //       it just paid shareholders (the buyout already valued that cash); any
  //       cash BEYOND the buyout is paid to the CEO. A seizure (no compensation)
  //       or a vacant seat routes all of it to the treasury. Conserves money:
  //       ceoSurplus + treasuryRecoup === liquidCapital always.
  const forexEnabled = await isForexEnabled();
  if (liquidCapitalAnchor > 0) {
    const ceoChar =
      params.tier === "seizure" || target.ceoVacant || !target.ceoId
        ? null
        : await db.collection<Character>("characters").findOne({ _id: target.ceoId });
    const ceoSurplusAnchor = ceoChar ? Math.max(0, liquidCapitalAnchor - payoutPoolAnchor) : 0;
    const treasuryCashAnchor = liquidCapitalAnchor - ceoSurplusAnchor;

    if (ceoChar && ceoSurplusAnchor > 0) {
      const currency = getHomeCurrency(ceoChar);
      const rate = fxByCurrency.get(currency as CurrencyCode) ?? 1;
      const amt = Math.round(forexEnabled ? ceoSurplusAnchor * rate : ceoSurplusAnchor);
      await db
        .collection<Character>("characters")
        .updateOne(
          { _id: ceoChar._id },
          { $inc: buildPersonalBalanceInc(amt, currency, forexEnabled), $set: { updatedAt: now } }
        );
    }
    if (treasuryCashAnchor > 0) {
      const cashCurrency = (target.liquidCurrencyCode ??
        COUNTRY_CURRENCY_MAP[target.countryId] ??
        "USD") as CurrencyCode;
      const rate = fxByCurrency.get(cashCurrency) ?? 1;
      await creditTreasuryProceeds(
        db,
        params.countryId,
        writeGovBudgetLocal(treasuryCashAnchor, cashCurrency, rate),
        now
      );
    }
  }

  // ── 4. Partition by jurisdiction. DOMESTIC sectors are absorbed into the
  //       NatCorp that owns each sector TYPE (a taking spanning multiple types
  //       fans across split-offs + primary; each MERGES into the NatCorp's
  //       existing (state, type) holding so a repeat can't collide on the unique
  //       index). FOREIGN sectors (operated outside this country) cannot be held
  //       under another jurisdiction — they are released to the open unowned
  //       market. A sector with no countryId defaults to domestic (legacy-safe).
  const domesticSectors = targetSectors.filter(
    (s) => !s.countryId || s.countryId === params.countryId
  );
  const foreignSectors = targetSectors.filter(
    (s) => s.countryId && s.countryId !== params.countryId
  );

  // Snapshot the SOCI escalation multiplier at taking time (one value for the
  // whole-corp taking) so the transition shock is fixed to today's concentration.
  const transitionMultiplier = sociMultiplier(
    await readStateOwnershipConcentration(db, params.countryId)
  );

  const destByType = new Map<string, ObjectId>();
  for (const s of domesticSectors) {
    let destId = destByType.get(s.sectorType);
    if (!destId) {
      const dest = await resolveNationalCorporationForSector(db, params.countryId, s.sectorType);
      destId = dest._id;
      destByType.set(s.sectorType, destId);
    }
    await absorbSectorIntoNatCorp(
      db,
      s,
      destId,
      params.consequence.turn,
      now,
      transitionMultiplier,
      corpPlantsEnabled
    );
  }
  for (const s of foreignSectors) {
    // A foreign sector's revenue is stored in ITS host-state currency, not the
    // (donor) corp's — convert to the ₳-native unowned pool at the host rate.
    await releaseSectorToUnowned(
      db,
      s,
      resolveSectorHostCurrencyCode(s, target),
      fxRateForSectorHostFromMap(s, target, fxByCurrency),
      now,
      corpPlantsEnabled,
      corpEraUnitScale
    );
  }

  // ── 5. State assumes the seized corp's issued bonds (re-stamp; no default). ──
  if (targetBonds.length > 0) {
    await bonds.updateMany(
      { corporationId: target._id, matured: false },
      { $set: { corporationId: nationalCorp._id, originalIssuerName: target.name, updatedAt: now } }
    );
  }

  // ── 5b. Transfer shares owned by the seized corp in other corporations. ──
  // ── 5b. Transfer shares owned by the seized corp in other corporations. ──
  // When a corporation owns shares in other corporations, those shares must be
  // transferred rather than silently destroyed during dissolution (Bug #0803).
  await transferOwnedSharesToNatCorp(db, target, nationalCorp._id, fxByCurrency, now);

  // ── 6. Dissolve the seized shell. ──
  await cleanupShareMarketActivityForCorporations(db, [target._id], now, forexEnabled);
  await stampSubjectDeleted(db, target._id, {
    sequentialId: target.sequentialId,
    deletedAt: now,
  });
  await corps.deleteOne({ _id: target._id });

  // Politics + investor-confidence (spec §12). `target` + `targetSectors` are
  // still in scope here (captured before the shell was deleted), so the foreign
  // owner + sector types are available for framing.
  // Framing reflects what the state actually NATIONALIZED — the domestic sectors
  // taken into the NatCorp. Foreign holdings were divested to the open market.
  const sectorTypesTaken = Array.from(new Set(domesticSectors.map((s) => s.sectorType)));
  const consequenceResult = await applyNationalizationConsequences(db, {
    countryId: params.countryId,
    method: params.consequence.method,
    tier: params.tier,
    triggers: params.consequence.triggers,
    sectorTypes: sectorTypesTaken,
    valuationAnchor,
    compensationAnchor: payoutPoolAnchor,
    foreignOwnerCountryId: target.countryId !== params.countryId ? target.countryId : null,
    governingPartyId: params.consequence.governingPartyId ?? null,
    turn: params.consequence.turn,
    actorCharacterId: params.consequence.actorCharacterId,
  });

  // Acquisition ledger (Register tab). Best-effort — a failed write never aborts.
  try {
    await recordNationalizationLedger(db, {
      countryId: params.countryId,
      nationalCorporationId: nationalCorp._id,
      kind: "nationalize_whole",
      method: params.consequence.method,
      triggers: params.consequence.triggers,
      tier: params.tier,
      valuationAnchor,
      compensationAnchor: payoutPoolAnchor,
      debtAnchor,
      shareholdersSettled: target.shareholders?.length ?? 0,
      sectorTypes: sectorTypesTaken,
      formerCorpName: target.name,
      foreignOwnerCountryId: target.countryId !== params.countryId ? target.countryId : null,
      confidenceBefore: consequenceResult.confidenceBefore,
      confidenceAfter: consequenceResult.confidenceAfter,
      legitimacyDelta: consequenceResult.legitimacyDelta,
      turn: params.consequence.turn,
    });
  } catch (err) {
    console.error("[nationalizationLedger] whole-corp ledger write failed:", err);
  }

  return {
    nationalCorporationId: nationalCorp._id,
    sectorsAbsorbed: domesticSectors.length,
    bondsAssumed: targetBonds.length,
    shareholderPayoutAnchor: payoutPoolAnchor,
  };
}

/**
 * Distribute a ₳-denominated shareholder pool pro-rata across every bucket —
 * character + imperial holders (to personal cash, in home currency), corporate
 * holders (to liquidCapital), and the public float (to the country's central
 * bank reserve). Mirrors the bucket handling of the dissolution settlement so
 * no slice is silently dropped.
 */
export async function payShareholders(
  db: Db,
  target: Corporation,
  poolAnchor: number,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>,
  now: Date
): Promise<void> {
  const allocation = allocateShareholderPool(target, poolAnchor, new Map());
  const forexEnabled = await isForexEnabled();

  const anchorToLocal = (amtAnchor: number, currency: string): number => {
    const rate = fxByCurrency.get(currency as CurrencyCode);
    return Number.isFinite(rate) && rate && rate > 0 ? amtAnchor * rate : amtAnchor;
  };

  // Character + imperial holders → personal cash, split by collection.
  const charRows = allocation.characterRows.filter((r) => !r.isImperial && r.payout > 0);
  const imperialRows = allocation.characterRows.filter((r) => r.isImperial && r.payout > 0);

  if (charRows.length > 0) {
    const ids = charRows.map((r) => new ObjectId(r.characterId));
    const docs = await db
      .collection<Character>("characters")
      .find({ _id: { $in: ids } })
      .toArray();
    const currencyById = new Map(docs.map((c) => [c._id.toString(), getHomeCurrency(c)]));
    await db.collection<Character>("characters").bulkWrite(
      charRows.map((r) => {
        const currency = currencyById.get(r.characterId) ?? "USD";
        const amt = forexEnabled ? anchorToLocal(r.payout, currency) : r.payout;
        return {
          updateOne: {
            filter: { _id: new ObjectId(r.characterId) },
            update: {
              $inc: buildPersonalBalanceInc(amt, currency, forexEnabled),
              $set: { updatedAt: now },
            },
          },
        };
      })
    );
  }

  if (imperialRows.length > 0) {
    const ids = imperialRows.map((r) => new ObjectId(r.characterId));
    const docs = await db
      .collection<ImperialCharacter>("imperialCharacters")
      .find({ _id: { $in: ids } })
      .toArray();
    const currencyById = new Map(docs.map((c) => [c._id.toString(), getHomeCurrency(c)]));
    await db.collection<ImperialCharacter>("imperialCharacters").bulkWrite(
      imperialRows.map((r) => {
        const currency = currencyById.get(r.characterId) ?? "USD";
        const amt = forexEnabled ? anchorToLocal(r.payout, currency) : r.payout;
        return {
          updateOne: {
            filter: { _id: new ObjectId(r.characterId) },
            update: {
              $inc: buildPersonalBalanceInc(amt, currency, forexEnabled),
              $set: { updatedAt: now },
            },
          },
        };
      })
    );
  }

  // Corporate equity holders → liquidCapital, in each corp's home currency.
  const corpRows = allocation.corporationRows.filter((r) => r.payout > 0);
  if (corpRows.length > 0) {
    const ids = corpRows.map((r) => new ObjectId(r.corporationId));
    const docs = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: ids } })
      .toArray();
    const corpById = new Map(docs.map((c) => [c._id.toString(), c]));
    await db.collection<Corporation>("corporations").bulkWrite(
      corpRows.map((r) => {
        const creditor = corpById.get(r.corporationId);
        const creditorCurrency = (creditor?.liquidCurrencyCode ??
          COUNTRY_CURRENCY_MAP[creditor?.countryId as CountryId] ??
          "USD") as CurrencyCode;
        const rate = fxByCurrency.get(creditorCurrency) ?? 1;
        const amtInCapital = Math.round(anchorToCorpLiquidCapital(r.payout, creditor ?? {}, rate));
        return {
          updateOne: {
            filter: { _id: new ObjectId(r.corporationId) },
            update: { $inc: { liquidCapital: amtInCapital }, $set: { updatedAt: now } },
          },
        };
      })
    );
  }

  // Public float → the national treasury (no value dropped). Same unified
  // treasury the rest of the nationalization money flows move (spec §5).
  if (allocation.publicFloatRow && allocation.publicFloatRow.payout > 0) {
    const floatCurrency = (target.liquidCurrencyCode ??
      COUNTRY_CURRENCY_MAP[target.countryId] ??
      "USD") as CurrencyCode;
    const rate = fxByCurrency.get(floatCurrency) ?? 1;
    const floatLocal = writeGovBudgetLocal(allocation.publicFloatRow.payout, floatCurrency, rate);
    await creditTreasuryProceeds(db, target.countryId, floatLocal, now);
  }

  // Index-fund shareholders → fund cash (₳). Same pool, no FX (cashAnchor is ₳).
  // #3451: previously dropped by allocateShareholderPool. The whole-corp shell is
  // deleted after this transition, so the fund's holding of it is pulled too.
  if (allocation.fundRows.length > 0) {
    await payFundShareholderRows(db, allocation.fundRows, target._id, now);
  }
}

/**
 * Transfer shares owned by the seized corporation in other corporations to the
 * National Corporation. When a corporation owns shares in other corporations,
 * those shares must be transferred rather than silently destroyed during
 * dissolution (Bug #0803).
 *
 * For each corporation where the seized corp holds shares, we transfer those
 * shares to the National Corporation at their current market value.
 */
async function transferOwnedSharesToNatCorp(
  db: Db,
  seizedCorp: Corporation,
  nationalCorpId: ObjectId,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>,
  now: Date
): Promise<void> {
  const corps = db.collection<Corporation>("corporations");

  // Find all corporations where the seized corp owns shares
  const targetCorps = await corps
    .find({
      "shareholders.corporationId": seizedCorp._id,
    })
    .toArray();

  if (targetCorps.length === 0) {
    return; // No shares to transfer
  }

  // For each corporation where seizedCorp owns shares, transfer those shares to nationalCorp
  for (const targetCorp of targetCorps) {
    const shareholderEntry = targetCorp.shareholders?.find((sh) =>
      sh.corporationId?.equals(seizedCorp._id)
    );

    if (!shareholderEntry || shareholderEntry.shares <= 0) {
      continue;
    }

    // Calculate the value of the shares being transferred
    const shares = shareholderEntry.shares;
    const sharePrice = targetCorp.sharePrice ?? 0;
    const shareValueAnchor = corpLiquidCapitalToAnchor(
      shares * sharePrice,
      targetCorp,
      fxByCurrency.get(targetCorp.liquidCurrencyCode as CurrencyCode) ?? 1
    );

    // Remove the seized corp's shareholder entry
    await corps.updateOne(
      { _id: targetCorp._id },
      {
        $pull: {
          shareholders: { corporationId: seizedCorp._id },
        },
        $set: { updatedAt: now },
      }
    );

    // Transfer the shares to the National Corporation as a shareholder of the
    // target corporation (not to the NatCorp's own shareholders array).
    const existingEntry = targetCorp.shareholders?.find((sh) =>
      sh.corporationId?.equals(nationalCorpId)
    );

    if (existingEntry) {
      const combinedShares = existingEntry.shares + shares;
      const combinedAvgCost =
        combinedShares > 0
          ? (existingEntry.shares * (existingEntry.avgCostPerShare ?? 0) +
              shares * (shareholderEntry.avgCostPerShare ?? 0)) /
            combinedShares
          : 0;
      await corps.updateOne(
        { _id: targetCorp._id },
        {
          $set: {
            "shareholders.$[elem].shares": combinedShares,
            "shareholders.$[elem].avgCostPerShare": combinedAvgCost,
            updatedAt: now,
          },
        },
        { arrayFilters: [{ "elem.corporationId": nationalCorpId }] }
      );
    } else {
      await corps.updateOne(
        { _id: targetCorp._id },
        {
          $push: {
            shareholders: {
              corporationId: nationalCorpId,
              shares: shares,
              avgCostPerShare: shareholderEntry.avgCostPerShare,
            },
          },
          $set: { updatedAt: now },
        }
      );
    }

    // Credit the national corp with the value of the shares
    const nationalCorp = await corps.findOne({ _id: nationalCorpId });
    if (nationalCorp) {
      const nationalCorpFxRate =
        fxByCurrency.get(nationalCorp.liquidCurrencyCode as CurrencyCode) ?? 1;
      const valueInNatCorpCurrency = Math.round(
        anchorToCorpLiquidCapital(shareValueAnchor, nationalCorp, nationalCorpFxRate)
      );

      await corps.updateOne(
        { _id: nationalCorpId },
        {
          $inc: { liquidCapital: valueInNatCorpCurrency },
          $set: { updatedAt: now },
        }
      );
    }
  }
}

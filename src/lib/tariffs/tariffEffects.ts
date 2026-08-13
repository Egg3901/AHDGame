import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Bill, Tariff, TariffProvision } from "@/lib/db/types";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { FederalBudget, FederalTaxRates } from "@/lib/db/types/budget";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { fireTariffPulse } from "@/lib/corporations/sentimentEvents";
import {
  calculateFederalRevenue,
  normalizeFederalTaxRates,
  loadLatestSourcedImportAggregates,
} from "@/lib/budget/revenue";
import { isFtaActive, type FtaPairSet, type FtaCoverage } from "./ftaOverrides";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { getCurrentTurn } from "@/lib/currentTurn";

function finiteRate(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Compute the effective tariff rate for a specific corp+sector combination in a country.
 * TERRITORIAL INVARIANT: only tariffs where tariff.countryId === sectorCountryId are consulted.
 * Returns 0 for domestic corps (sectorCountryId === corpHqCountryId).
 *
 * If `activeFtaPairs` is supplied and the (sectorCountry, corpHqCountry) pair is bound
 * by an active free-trade agreement, returns 0 — FTAs override all tariff layers
 * between the partnered countries (org-level legislation, see ftaOverrides.ts).
 */
export function getEffectiveTariffRate(
  tariffs: Tariff[],
  sectorCountryId: CountryId,
  sectorType: CorporationType,
  corpHqCountryId: CountryId,
  corpId: ObjectId | undefined,
  activeFtaPairs?: FtaPairSet
): number {
  // Domestic corps pay no tariff
  if (sectorCountryId === corpHqCountryId) return 0;
  // Free-trade agreements zero out all tariff layers between member partners.
  if (activeFtaPairs && isFtaActive(activeFtaPairs, sectorCountryId, corpHqCountryId)) {
    return 0;
  }

  let total = 0;
  for (const t of tariffs) {
    // Territorial invariant: only apply tariffs from the sector's country
    if (t.countryId !== sectorCountryId) continue;
    const rate = finiteRate(t.rate);
    if (rate === 0) continue;

    if (t.scopeType === "economy_wide") {
      total += rate;
    } else if (t.scopeType === "sector" && t.targetSectorType === sectorType) {
      total += rate;
    } else if (t.scopeType === "origin_country" && t.targetOriginCountryId === corpHqCountryId) {
      total += rate;
    } else if (
      t.scopeType === "corporation" &&
      corpId != null &&
      t.targetCorporationId?.toString() === corpId.toString()
    ) {
      total += rate;
    }
  }
  return Number.isFinite(total) ? Math.min(100, total) : 0;
}

/**
 * Collapse all active tariff layers into one macro inflation-pressure input for a country.
 *
 * Economy-wide tariffs count fully. Narrower tariff scopes contribute proportionally to the
 * share of in-country sector revenue they touch, so targeted tariffs still move inflation
 * without behaving like blanket trade barriers.
 *
 * When `ftaCoverage` is supplied, FTA exposure neutralises the corresponding tariff
 * contribution at every scope — broad scopes (economy_wide, sector) scale by
 * `(1 − partner-share)` of foreign exposure (mirroring `getTariffBlendWeights`), and narrow
 * scopes (origin_country, corporation) flip binary on `pairs` membership. This keeps the
 * inflation channel and the corporate-margin channel consistent: a tariff that has been
 * neutralised by an FTA on the trade-flow side does not drive consumer-price inflation either.
 */
export function computeCountryTariffPressure(
  tariffs: Tariff[],
  countryId: CountryId,
  sectors: Pick<CorporateSector, "corporationId" | "countryId" | "sectorType" | "revenue">[],
  corpById: Map<string, Pick<Corporation, "_id" | "countryId">>,
  ftaCoverage?: FtaCoverage
): number {
  let totalDomesticRevenue = 0;
  const sectorRevenueByType = new Map<CorporationType, number>();
  const originRevenueByCountry = new Map<CountryId, number>();
  const corporationRevenueById = new Map<string, number>();

  for (const sector of sectors) {
    if (sector.countryId !== countryId) continue;
    const revenue = finiteRate(sector.revenue);
    if (!(revenue > 0)) continue;

    totalDomesticRevenue += revenue;

    sectorRevenueByType.set(
      sector.sectorType,
      (sectorRevenueByType.get(sector.sectorType) ?? 0) + revenue
    );

    const corp = corpById.get(sector.corporationId.toString());
    if (!corp) continue;

    corporationRevenueById.set(
      sector.corporationId.toString(),
      (corporationRevenueById.get(sector.corporationId.toString()) ?? 0) + revenue
    );

    if (corp.countryId !== countryId) {
      originRevenueByCountry.set(
        corp.countryId,
        (originRevenueByCountry.get(corp.countryId) ?? 0) + revenue
      );
    }
  }

  let pressure = 0;

  for (const tariff of tariffs) {
    if (tariff.countryId !== countryId) continue;
    const rate = finiteRate(tariff.rate);
    if (rate === 0) continue;

    if (tariff.scopeType === "economy_wide") {
      const ftaShare = ftaCoverage?.byCountryEconomyWide.get(countryId) ?? 0;
      pressure += rate * (1 - ftaShare);
      continue;
    }

    if (totalDomesticRevenue <= 0) continue;

    if (tariff.scopeType === "sector" && tariff.targetSectorType) {
      const exposureShare =
        (sectorRevenueByType.get(tariff.targetSectorType as CorporationType) ?? 0) /
        totalDomesticRevenue;
      const sectorKey = `${countryId}:${tariff.targetSectorType}`;
      const ftaShare = ftaCoverage?.bySectorType.get(sectorKey) ?? 0;
      pressure += rate * exposureShare * (1 - ftaShare);
      continue;
    }

    if (tariff.scopeType === "origin_country" && tariff.targetOriginCountryId) {
      if (ftaCoverage && isFtaActive(ftaCoverage.pairs, countryId, tariff.targetOriginCountryId)) {
        continue;
      }
      const exposureShare =
        (originRevenueByCountry.get(tariff.targetOriginCountryId) ?? 0) / totalDomesticRevenue;
      pressure += rate * exposureShare;
      continue;
    }

    if (tariff.scopeType === "corporation" && tariff.targetCorporationId) {
      const corp = corpById.get(tariff.targetCorporationId.toString());
      if (corp && ftaCoverage && isFtaActive(ftaCoverage.pairs, countryId, corp.countryId)) {
        continue;
      }
      const exposureShare =
        (corporationRevenueById.get(tariff.targetCorporationId.toString()) ?? 0) /
        totalDomesticRevenue;
      pressure += rate * exposureShare;
    }
  }

  return Number.isFinite(pressure) ? Math.min(100, pressure) : 0;
}

/**
 * Compute blend weights for commodity margin calculation for a (countryId, sectorType) pair.
 * Economy-wide and sector tariffs always contribute; origin-country and corp-specific
 * contribute only where the targeted entities have presence (via allSectorKeys).
 *
 * The blend starts at 50/25/25 (global / national / local) with no tariff pressure and
 * shifts linearly toward 25/50/25 at 100% effective tariff coverage.
 *
 * When `ftaCoverage` is supplied, the broad scopes scale by `(1 − partner-exposure share)`
 * (same proportional model as `getDomesticTariffMalus`) and the narrow scopes flip binary:
 * an `origin_country` tariff aimed at an FTA partner contributes 0; a `corporation` tariff
 * aimed at a corp HQ'd in an FTA partner contributes 0. Non-partner foreign trade still
 * pulls the blend toward national as before.
 *
 * allSectorKeys format:
 *   origin_country scope: `${sectorCountryId}:${originCountryId}:${sectorType}`
 *   corporation scope:    `${sectorCountryId}:corp:${corpId}:${sectorType}`
 */
export function getTariffBlendWeights(
  tariffs: Tariff[],
  sectorCountryId: CountryId,
  sectorType: CorporationType,
  allSectorKeys: ReadonlySet<string>,
  ftaCoverage?: FtaCoverage
): { globalWeight: number; nationalWeight: number; localWeight: number } {
  const economyWideShare = ftaCoverage?.byCountryEconomyWide.get(sectorCountryId) ?? 0;
  const sectorKey = `${sectorCountryId}:${sectorType}`;
  const sectorShare = ftaCoverage?.bySectorType.get(sectorKey) ?? 0;

  let blendRate = 0;

  for (const t of tariffs) {
    if (t.countryId !== sectorCountryId) continue;
    const rate = finiteRate(t.rate);
    if (rate === 0) continue;

    if (t.scopeType === "economy_wide") {
      blendRate += rate * (1 - economyWideShare);
    } else if (t.scopeType === "sector" && t.targetSectorType === sectorType) {
      blendRate += rate * (1 - sectorShare);
    } else if (t.scopeType === "origin_country") {
      if (
        ftaCoverage &&
        t.targetOriginCountryId &&
        isFtaActive(ftaCoverage.pairs, sectorCountryId, t.targetOriginCountryId)
      ) {
        continue;
      }
      const key = `${sectorCountryId}:${t.targetOriginCountryId}:${sectorType}`;
      if (allSectorKeys.has(key)) blendRate += rate;
    } else if (t.scopeType === "corporation" && t.targetCorporationId != null) {
      const targetHq = ftaCoverage?.corpHqByCorpId.get(t.targetCorporationId.toString());
      if (ftaCoverage && targetHq && isFtaActive(ftaCoverage.pairs, sectorCountryId, targetHq)) {
        continue;
      }
      const key = `${sectorCountryId}:corp:${t.targetCorporationId.toString()}:${sectorType}`;
      if (allSectorKeys.has(key)) blendRate += rate;
    }
  }

  // Tariff pressure shifts weight from global to national linearly while keeping the
  // local/state component fixed. 38% tariffs produce a 38% move along that curve.
  const T = Math.min(100, blendRate);
  const tariffEffect = T / 100;
  const localWeight = 0.25;
  const nationalWeight = 0.25 + tariffEffect * 0.25;
  const globalWeight = 0.5 - tariffEffect * 0.25;
  return { globalWeight, nationalWeight, localWeight };
}

/**
 * True when any active tariff uses origin_country or corporation scope — those layers need
 * cross-border sector presence keys for {@link getTariffBlendWeights}.
 */
export function tariffRulesNeedSectorPresenceKeys(tariffs: Tariff[]): boolean {
  for (const t of tariffs) {
    if (finiteRate(t.rate) === 0) continue;
    if (t.scopeType === "origin_country" || t.scopeType === "corporation") return true;
  }
  return false;
}

/**
 * Same keys as {@link CorporationLookups.sectorPresenceKeys} in turn processing:
 * cross-border sectors only; used for tariff-aware commodity margin blending.
 */
export function buildSectorPresenceKeys(
  sectors: Pick<CorporateSector, "corporationId" | "countryId" | "sectorType">[],
  corpById: Map<string, Pick<Corporation, "_id" | "countryId">>
): Set<string> {
  const keys = new Set<string>();
  for (const sector of sectors) {
    const corp = corpById.get(sector.corporationId.toString());
    if (!corp) continue;
    const sectorCountry = sector.countryId;
    const corpCountry = corp.countryId;
    if (sectorCountry === corpCountry) continue;
    keys.add(`${sectorCountry}:${corpCountry}:${sector.sectorType}`);
    keys.add(`${sectorCountry}:corp:${sector.corporationId.toString()}:${sector.sectorType}`);
  }
  return keys;
}

/**
 * Margin modifier for foreign corps: -(effectiveTariffRate) percentage points.
 * Returns 0 for domestic corps (they pay a separate domestic malus instead).
 */
export function getForeignTariffMarginModifier(
  tariffs: Tariff[],
  sectorCountryId: CountryId,
  sectorType: CorporationType,
  corpHqCountryId: CountryId,
  corpId: ObjectId | undefined,
  activeFtaPairs?: FtaPairSet
): number {
  const rate = getEffectiveTariffRate(
    tariffs,
    sectorCountryId,
    sectorType,
    corpHqCountryId,
    corpId,
    activeFtaPairs
  );
  // Guard: -0 and 0 are not Object.is equal; return 0 explicitly when no tariff applies
  if (rate === 0) return 0;
  // Halved: a 40% tariff gives -20pp margin penalty, not -40pp.
  // Full 1:1 ratio made tariffs too punitive for foreign corps operating
  // in the tariff country, effectively killing their margins.
  return -rate / 2;
}

/**
 * Margin malus for domestic corps from economy-wide and sector tariffs only.
 * At 100% combined rate → -10pp. Scales linearly.
 *
 * Only economy-wide and sector scope layers contribute because those are the tariffs
 * broad enough to create domestic supply-chain friction. Origin-country and corp-specific
 * tariffs are too narrow to create systemic domestic cost pressure.
 *
 * When `ftaCoverage` is supplied, each contributing layer is scaled by
 * `(1 − partner-exposure share)` — the FTA-partner share of foreign trade in
 * the country (economy-wide) or the matching sector type (sector). A country
 * whose foreign-corp footprint is fully FTA-covered pays no malus from those
 * broad tariffs, since duty-free partner inputs relieve the supply-chain
 * friction that motivates the malus.
 *
 * Returns 0 for foreign corps (they pay the full rate via getForeignTariffMarginModifier).
 */
export function getDomesticTariffMalus(
  tariffs: Tariff[],
  sectorCountryId: CountryId,
  sectorType: CorporationType,
  corpHqCountryId: CountryId,
  ftaCoverage?: FtaCoverage
): number {
  // Only applies to domestic corps
  if (sectorCountryId !== corpHqCountryId) return 0;

  const economyWideShare = ftaCoverage?.byCountryEconomyWide.get(sectorCountryId) ?? 0;
  const sectorKey = `${sectorCountryId}:${sectorType}`;
  const sectorShare = ftaCoverage?.bySectorType.get(sectorKey) ?? 0;

  let total = 0;
  for (const t of tariffs) {
    if (t.countryId !== sectorCountryId) continue;
    const rate = finiteRate(t.rate);
    if (rate === 0) continue;
    if (t.scopeType === "economy_wide") {
      total += rate * (1 - economyWideShare);
    } else if (t.scopeType === "sector" && t.targetSectorType === sectorType) {
      total += rate * (1 - sectorShare);
    }
  }
  const T = Math.min(100, total);
  const malus = -(T / 100) * 10;
  return Object.is(malus, -0) ? 0 : malus;
}

/**
 * Split capture multiplier based on effective tariff rate (0–100).
 * Scales linearly between 1.0 (no tariff) and 1.5x / 0.5x (100% tariff).
 *
 * Domestic corps gain market share as foreign competitors are priced out;
 * foreign corps lose it as their costs rise relative to domestic incumbents.
 *
 * @param effectiveTariffRate - 0–100
 * @param isDomesticSplittingForeign - true = domestic bonus; false = foreign penalty
 */
export function getSplitCaptureMultiplier(
  effectiveTariffRate: number,
  isDomesticSplittingForeign: boolean
): number {
  const T = Math.max(0, Math.min(100, effectiveTariffRate));
  if (isDomesticSplittingForeign) {
    return 1.0 + (T / 100) * 0.5;
  }
  return 1.0 - (T / 100) * 0.5;
}

/**
 * Upsert a tariff document for a trade bill provision and report whether the
 * rate materially changed. Uses the five-field composite key so re-enacting the
 * same scope replaces rather than duplicates the tariff. Most recent bill wins
 * within the same scope.
 *
 * This function is intentionally **idempotent and side-effect-free** beyond the
 * tariff doc and a self-healing budget tax-rate sync (so `reconcileSignedTariffBills`
 * — which replays every signed tariff bill on every GET — can run safely as a
 * pure data rebuild). Sentiment pulses are emitted by the bill-enactment path
 * via `fireTariffProvisionSentiment`, gated on the returned `rateChanged` flag.
 *
 * Returns `{ rateChanged }`:
 *   - `true`  — first time this scope is set, or rate differs from the existing doc.
 *               Callers in real-enactment paths should fire dependent side effects.
 *   - `false` — same-rate replay (idempotent reconcile pass). Skip side effects.
 */
export async function applyTariffProvision(
  db: Db,
  countryId: CountryId,
  provision: TariffProvision,
  sourceBillId: ObjectId
): Promise<{ rateChanged: boolean }> {
  const now = new Date();
  const filter: Record<string, unknown> = {
    countryId,
    scopeType: provision.scopeType,
    targetSectorType: provision.targetSectorType ?? null,
    targetOriginCountryId: provision.targetOriginCountryId ?? null,
    targetCorporationId: provision.targetCorporationId
      ? new ObjectId(String(provision.targetCorporationId))
      : null,
  };

  // Read-before-write so the caller can distinguish a no-op replay (idempotent
  // reconcile) from a real policy change. Worst-case race: two concurrent
  // enacts that both see "no existing" double-fire pulses — acceptable given
  // the 24h pulse TTL and negligible policy-enactment frequency vs. the
  // read-path replay rate.
  const existing = await db.collection<Tariff>("tariffs").findOne(filter);
  const rateChanged = !existing || finiteRate(existing.rate) !== finiteRate(provision.rate);

  await db.collection<Tariff>("tariffs").updateOne(
    filter,
    {
      $set: { rate: provision.rate, sourceBillId, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  // Economy-wide tariffs drive the budget's headline tariff rate, which feeds
  // revenue projections via importValue × taxRates.tariffs%. Sector / origin /
  // corp-specific tariffs aren't representable as a single aggregate rate, so
  // their fiscal impact flows in via the corporate margin path the next turn.
  //
  // Sync only when the budget rate is out of step with the provision rate.
  // Reconcile replays of the same bill find the budget already in sync and
  // skip the expensive `calculateFederalRevenue` recompute; a stale budget
  // (e.g., write-failed mid-enactment) is still healed on next replay.
  if (provision.scopeType === "economy_wide") {
    const budgetId = getNationalBudgetId(countryId);
    const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
    const normalizedTaxRates = normalizeFederalTaxRates(budget?.taxRates);
    if (
      budget &&
      normalizedTaxRates &&
      finiteRate(normalizedTaxRates.tariffs) !== finiteRate(provision.rate)
    ) {
      const newTaxRates: FederalTaxRates = {
        ...normalizedTaxRates,
        tariffs: provision.rate,
      };
      // Money wiring (interstate-logistics plan step 5, phase B): this is a
      // rare rate-change event (a tariff bill just enacted), not a per-turn
      // hot loop, so a direct read here (rather than a caller-hoisted map)
      // stays cheap. Same netting rule as `refreshNationalBudgetRevenue`.
      const moneyWiringConfig = await db
        .collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { interstateMoneyWiringEnabled: 1 } });
      let sourcedImports: { tariffPaidAnchor: number; importValueAnchor: number } | undefined;
      if (moneyWiringConfig?.interstateMoneyWiringEnabled === true) {
        const [sourcedByCountry] = await Promise.all([
          loadLatestSourcedImportAggregates(db, await getCurrentTurn(db)),
        ]);
        const agg = sourcedByCountry.get(countryId);
        if (agg) {
          sourcedImports = { tariffPaidAnchor: agg.tariffPaid, importValueAnchor: agg.importValue };
        }
      }
      const fxByCurrency = sourcedImports ? await loadFxRatesByCurrency(db) : undefined;
      const newRevenue = await calculateFederalRevenue(
        db,
        newTaxRates,
        budgetId,
        undefined,
        undefined,
        undefined,
        fxByCurrency,
        sourcedImports
      );
      const newSurplus = newRevenue.total - (budget.spending?.total ?? 0);
      await db.collection<FederalBudget>("federalBudget").updateOne(
        { _id: budgetId },
        {
          $set: {
            taxRates: newTaxRates,
            revenue: newRevenue,
            surplus: newSurplus,
            updatedAt: now,
          },
        }
      );
    }
  }

  return { rateChanged };
}

/**
 * Emit the market-sentiment pulses associated with enacting a tariff provision.
 *
 * This is the bill-enactment side effect — call it from `legislationEffects.ts`
 * after `applyTariffProvision`, gated on the returned `rateChanged` flag. Do
 * not call from idempotent rebuild paths like `reconcileSignedTariffBills`,
 * which would otherwise deposit fresh pulse pairs on every API read and pin
 * affected corps to the negative sentiment cap.
 *
 * Sector tariffs emit a paired `+0.07 / -0.07` sentiment swing (domestic boost,
 * foreign penalty); other tariff scopes have no associated sentiment pulse.
 */
export async function fireTariffProvisionSentiment(
  db: Db,
  countryId: CountryId,
  provision: TariffProvision
): Promise<void> {
  if (provision.scopeType !== "sector" || !provision.targetSectorType) return;
  await Promise.all([
    fireTariffPulse(db, provision.targetSectorType, countryId, +0.07, "domestic"),
    fireTariffPulse(db, provision.targetSectorType, countryId, -0.07, "foreign"),
  ]);
}

/**
 * Emit foreign-side sentiment pulses for every signed sector tariff in a
 * country, modelling the market shock when an FTA exemption disappears.
 *
 * Call from the FTA-withdrawal path (`updateOrganizationLegislationForWithdrawal`)
 * AFTER the legislation document has been updated. The existing FTA filter at
 * pulse-application time (`pulseAppliesToCorp`) reads the now-current FTA pair
 * set, so corps still covered by other active FTAs correctly suppress the pulse
 * — only newly-exposed (and already-non-partner) corps see the dip.
 *
 * Asymmetric vs. enactment:
 *   - Enactment fires both `+0.07 domestic` and `-0.07 foreign`: both sides have
 *     a real shock (domestic cheers protection, foreign braces for cost).
 *   - Rescission fires only `-0.07 foreign`: domestic corps' situation is
 *     unchanged on rescission — they had nominal protection before and still
 *     have it; only foreign corps' real exposure flips.
 *
 * Mirrors `fireTariffProvisionSentiment`'s scope filter: only sector tariffs
 * emit pulses. Economy-wide / origin-country / corporation-scope tariffs are
 * skipped by symmetry with the enactment path.
 */
export async function fireFtaRescissionSentiment(db: Db, countryId: CountryId): Promise<void> {
  const signedBills = await db
    .collection<Bill>("bills")
    .find({
      countryId,
      status: "signed",
      "provisions.type": "tariff",
    })
    .project<{ provisions?: Bill["provisions"] }>({ provisions: 1 })
    .toArray();

  // Dedupe by sector — multiple bills can target the same sector at different
  // rates, but the active tariff is whichever upsert won, and the market shock
  // for "this sector is suddenly hot again" should fire once per sector, not
  // per historical bill.
  const sectorTypes = new Set<string>();
  for (const bill of signedBills) {
    for (const provision of bill.provisions ?? []) {
      if (
        provision.type === "tariff" &&
        provision.scopeType === "sector" &&
        typeof provision.targetSectorType === "string"
      ) {
        sectorTypes.add(provision.targetSectorType);
      }
    }
  }

  if (sectorTypes.size === 0) return;

  await Promise.all(
    [...sectorTypes].map((sectorType) =>
      fireTariffPulse(db, sectorType, countryId, -0.07, "foreign")
    )
  );
}

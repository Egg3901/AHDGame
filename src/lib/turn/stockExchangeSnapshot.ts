/**
 * Generate pre-computed stock exchange snapshots for fast API responses.
 * Runs after corporation processing each turn, and on a five-minute cron between turns
 * so float and live quotes match intraday trades.
 */
import * as Sentry from "@sentry/nextjs";
import { findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import { ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  Bond,
  Character,
  Corporation,
  CorporateSector,
  CorporationHistory,
  FederalBudget,
  StateBudget,
  State,
  StockExchangeSnapshot,
  StockExchangeListing,
} from "@/lib/db/types";
import { perTurnCouponPayment } from "@/lib/constants/bonds";
import {
  imfFacilityPaymentAnchorPerTurn,
  anchorPerTurnToFinancialDaily,
} from "@/lib/imf/imfFacilityFinancials";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  anchorToCorpCapital,
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  loadValuationFxRates,
  resolveCorpLiquidCurrencyCode,
  resolveSectorHostCurrencyCode,
  fxRateForSectorHostFromMap,
} from "@/lib/currency/corporationCapital";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import {
  CORPORATION_TYPE_LABELS,
  CEO_INITIAL_SHARES,
  computeAllMarginModifiers,
  getHomeLocationMarginBonus,
  getStateSectorSpecializationMarginBonus,
  TYPE_SWITCH_PENALTY_TURNS,
  MAX_DIVIDEND_RATE,
} from "@/lib/constants/corporations";
import { getLegalStructureForCorp } from "@/lib/corporations/legalStructure";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { getSubsidyMarginModifier, getActiveSubsidies } from "@/lib/subsidies/subsidyEffects";
import { computeStateMetricMarginModifier } from "@/lib/corporations/sectorMetricMarginProfiles";
import { buildPoliticalBaseModifiers } from "@/lib/politicalLegislation/marginAdapter";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { resolveGameYear } from "@/lib/era/era";
import { getPublicShareQuote, getRoundedPublicMarketCap } from "@/lib/corporations/marketQuote";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import {
  getExchangeForCountry,
  getExchangeNamesMap,
  ALL_EXCHANGES,
} from "@/lib/constants/exchangeRegistry";
import { getControllingCorporateParent } from "@/lib/corporations/corporateOwnership";
import { TURNS_PER_YEAR, TURNS_PER_DAY } from "@/lib/constants/turnTime";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import { STRATEGY_TRANSITION_TURNS } from "@/lib/constants/sectorStrategies";

const EXCHANGE_NAMES: Record<string, string> = getExchangeNamesMap();

/**
 * Generate stock exchange snapshots for all exchanges.
 * Should be called once per turn after corporation turn processing.
 * Uses effective profit margin (with all modifiers) and includes bond interest costs
 * to match the corporation page's income calculation.
 */
export async function generateStockExchangeSnapshots(currentTurn: number, db?: Db): Promise<void> {
  return Sentry.startSpan(
    { name: "turn.stockExchangeSnapshot", op: "turn.phase", attributes: { turn: currentTurn } },
    async () => {
      const database = db ?? (await getDb());
      const now = new Date();

      // Fetch all data needed for snapshots
      const corporationsCollection = database.collection<Corporation>("corporations");
      // Compatibility repair for auction shells that later completed an IPO.
      // The late-IPO path used to clear isPrivate without clearing the auction's
      // hiddenFromExchange marker, leaving a public corporation absent from every
      // exchange forever. Future IPOs clear it in goPublic; this repairs existing
      // public rows before each idempotent snapshot build.
      await corporationsCollection.updateMany(
        {
          isPrivate: { $ne: true },
          hiddenFromExchange: true,
          lastIpoTurn: { $exists: true },
        },
        { $set: { hiddenFromExchange: false } }
      );
      const corporations = await corporationsCollection
        .find({ hiddenFromExchange: { $ne: true }, isPrivate: { $ne: true } })
        .sort({ createdAt: -1 })
        .toArray();

      if (corporations.length === 0) return;

      // Fetch CEO info (filter out corporations without a CEO)
      const regularCeoIds = corporations
        .filter((c) => c.ceoType !== "imperial" && c.ceoType !== "npp" && c.ceoId)
        .map((c) => c.ceoId);
      const imperialCeoIds = corporations
        .filter((c) => c.ceoType === "imperial" && c.ceoId)
        .map((c) => c.ceoId);
      const nppCeoIds = corporations
        .filter((c) => c.ceoType === "npp" && c.ceoId)
        .map((c) => c.ceoId);

      const [characters, imperialChars, nppChars] = await Promise.all([
        regularCeoIds.length > 0
          ? database
              .collection<Character>("characters")
              .find({ _id: { $in: regularCeoIds } })
              .project<{ _id: ObjectId; name: string; avatarUrl?: string; sequentialId?: number }>({
                _id: 1,
                name: 1,
                avatarUrl: 1,
                sequentialId: 1,
              })
              .toArray()
          : Promise.resolve([]),
        imperialCeoIds.length > 0
          ? database
              .collection("imperialCharacters")
              .find({ _id: { $in: imperialCeoIds } })
              .project<{ _id: ObjectId; name: string; avatarUrl?: string; sequentialId?: number }>({
                _id: 1,
                name: 1,
                avatarUrl: 1,
                sequentialId: 1,
              })
              .toArray()
          : Promise.resolve([]),
        nppCeoIds.length > 0
          ? database
              .collection("npps")
              .find({ _id: { $in: nppCeoIds } })
              .project<{ _id: ObjectId; name: string; avatarUrl?: string; sequentialId?: number }>({
                _id: 1,
                name: 1,
                avatarUrl: 1,
                sequentialId: 1,
              })
              .toArray()
          : Promise.resolve([]),
      ]);
      const ceoMap = new Map(
        [...characters, ...imperialChars, ...nppChars].map((c) => [c._id.toString(), c])
      );

      // Fetch sectors and multi-timeframe price history (1h, 24h, 48h)
      const corpIds = corporations.map((c) => c._id);
      const turn1Ago = Math.max(1, currentTurn - 1);
      const turn24Ago = Math.max(1, currentTurn - 24);
      const turn48Ago = Math.max(1, currentTurn - 48);

      const [allSectors, historyRows] = await Promise.all([
        database
          .collection<CorporateSector>("corporateSectors")
          .find({ corporationId: { $in: corpIds } })
          .toArray(),
        database
          .collection<CorporationHistory>("corporationHistory")
          .aggregate<{
            _id: ObjectId;
            history: { turn: number; sharePrice: number; totalShares: number }[];
          }>([
            {
              $match: {
                corporationId: { $in: corpIds },
              },
            },
            { $sort: { turn: -1 } },
            {
              $group: {
                _id: "$corporationId",
                history: {
                  $push: {
                    turn: "$turn",
                    sharePrice: "$sharePrice",
                    totalShares: "$totalShares",
                  },
                },
              },
            },
          ])
          .toArray(),
      ]);

      interface PriceHistoryPoint {
        turn: number;
        price: number;
        totalShares?: number;
      }

      const priceHistoryByCorpId = new Map<
        string,
        {
          h1: PriceHistoryPoint | null;
          h24: PriceHistoryPoint | null;
          h48: PriceHistoryPoint | null;
        }
      >();
      for (const entry of historyRows) {
        const corpId = entry._id.toString();
        const history = entry.history;

        const findAtOrBefore = (targetTurn: number): PriceHistoryPoint | null => {
          const point = history.find((h) => h.turn <= targetTurn);
          if (!point) return null;
          return {
            turn: point.turn,
            price: getPublicShareQuote(point),
            totalShares: point.totalShares,
          };
        };

        // Find best snapshots at each timeframe, fallback to earliest if needed
        let h1 = findAtOrBefore(turn1Ago);
        let h24 = findAtOrBefore(turn24Ago);
        let h48 = findAtOrBefore(turn48Ago);

        // Fallback to earliest available if no snapshot at timeframe
        if (!h1 && history.length > 0) {
          const earliest = history[history.length - 1];
          h1 = {
            turn: earliest.turn,
            price: getPublicShareQuote(earliest),
            totalShares: earliest.totalShares,
          };
        }
        if (!h24 && history.length > 0) {
          const earliest = history[history.length - 1];
          h24 = {
            turn: earliest.turn,
            price: getPublicShareQuote(earliest),
            totalShares: earliest.totalShares,
          };
        }
        if (!h48 && history.length > 0) {
          const earliest = history[history.length - 1];
          h48 = {
            turn: earliest.turn,
            price: getPublicShareQuote(earliest),
            totalShares: earliest.totalShares,
          };
        }

        priceHistoryByCorpId.set(corpId, { h1, h24, h48 });
      }

      // Calculate revenue, income, and growth per corp

      // Fetch state metrics, states, subsidies, and budgets (for tax rates) for net-income calculation
      const [allStateMetrics, allStates, allSubsidies, allFederalBudgets, allStateBudgetsForTax] =
        await Promise.all([
          // Legacy-shaped view for the margin engine's stored reads.
          findMergedRegionMetricsMany(database, {}),
          database
            .collection<State>("states")
            .find({})
            .project<Pick<State, "_id" | "countryId" | "sectorSpecializations">>({
              countryId: 1,
              sectorSpecializations: 1,
            })
            .toArray(),
          getActiveSubsidies(database),
          database
            .collection<FederalBudget>("federalBudget")
            .find(
              {},
              {
                projection: {
                  countryId: 1,
                  "taxRates.domesticCorporateTax": 1,
                  "taxRates.foreignCorporateTax": 1,
                },
              }
            )
            .toArray(),
          database
            .collection<StateBudget>("stateBudgets")
            .find(
              {},
              {
                projection: {
                  _id: 1,
                  "taxRates.domesticCorporateTax": 1,
                  "taxRates.foreignCorporateTax": 1,
                },
              }
            )
            .toArray(),
        ]);

      // Build domestic/foreign rate lookups. Per-sector tax selects based on
      // corp.countryId === sector.countryId (domestic) vs. otherwise (foreign).
      const domesticFederalRateByCountry = new Map<string, number>();
      const foreignFederalRateByCountry = new Map<string, number>();
      for (const fb of allFederalBudgets) {
        if (!fb.countryId) continue;
        const dom = fb.taxRates?.domesticCorporateTax;
        if (typeof dom === "number") domesticFederalRateByCountry.set(fb.countryId, dom);
        const fgn = fb.taxRates?.foreignCorporateTax;
        if (typeof fgn === "number") foreignFederalRateByCountry.set(fb.countryId, fgn);
      }
      const domesticStateRateByStateId = new Map<string, number>();
      const foreignStateRateByStateId = new Map<string, number>();
      for (const sb of allStateBudgetsForTax) {
        const dom = sb.taxRates?.domesticCorporateTax;
        if (typeof dom === "number") domesticStateRateByStateId.set(sb._id, dom);
        const fgn = sb.taxRates?.foreignCorporateTax;
        if (typeof fgn === "number") foreignStateRateByStateId.set(sb._id, fgn);
      }

      const stateMetricsById = new Map(allStateMetrics.map((m) => [m._id.toString(), m]));
      const stateById = new Map(allStates.map((s) => [s._id, s]));
      const stateCountryMap = new Map(allStates.map((s) => [s._id, s.countryId]));

      // SP4 §4a: political margin overlays for playable regions.
      const politicalDocs = await database
        .collection<PoliticalMetricsDoc>("politicalMetrics")
        .find({})
        .toArray();
      const politicalBaseModifiersByState = new Map(
        politicalDocs.map((doc) => [String(doc._id), buildPoliticalBaseModifiers(doc.values)])
      );

      // Calculate revenue, income, and growth per corp using effective margin
      const revenueByCorpId = new Map<string, number>();
      const incomeByCorpId = new Map<string, number>();
      const growthByCorpId = new Map<string, { total: number; count: number }>();
      const bondInterestByCorpId = new Map<string, number>();
      // Apportioned corporate tax and bond coupon income per corp — used to compute net income
      // that matches the corporation page (which is the real-world net income definition).
      const corporateTaxByCorpId = new Map<string, number>();
      const bondCouponIncomeByCorpId = new Map<string, number>();
      // IMF facility flows per corp (daily, anchor units) — net income includes these on the corp
      // page, so including them here keeps stock-market and corp-page numbers aligned for the
      // handful of corps currently under IMF restructuring.
      const imfFacilityPaymentDailyByCorpId = new Map<string, number>();
      const imfFacilityReceiptsDailyByCorpId = new Map<string, number>();

      // Fetch outstanding bonds for interest cost calculation + coupon income from held bonds
      const allBonds = await database.collection<Bond>("bonds").find({ matured: false }).toArray();

      // Live era year for the metric existence gate on margin signals; null
      // while eraSystemEnabled is off (legacy behavior). Fetched AFTER the main
      // corp/sector fetches so call-order-sensitive test harnesses keep their
      // queued collection mocks aligned.
      const eraGameState = await database
        .collection<import("@/lib/db/types").GameState>("gameState")
        .findOne(
          { _id: "current" },
          {
            projection: {
              currentYear: 1,
              currentTurn: 1,
              startingYear: 1,
              eraSystemEnabled: 1,
            },
          }
        );
      const eraYear = eraGameState?.eraSystemEnabled ? resolveGameYear(eraGameState) : null;

      // FX rates — needed for anchor-normalizing cross-currency bond cash flows below.
      // Loaded once, reused by the coupon-income accumulation, the per-corp interest
      // subtraction, and the listing consumer. Listing-level `fxByCurrency` still gets
      // reloaded inline near line 613 / 689 for the secondary ranking passes.
      const fxByCurrencySnapshot = await loadValuationFxRates(database);

      // Pre-compute coupon income per holder (daily) in ₳. A corp earns coupon income on
      // bonds where it appears in `bond.holders[].corporationId`, pro-rated by its held
      // units. `couponPerUnit × units × TURNS_PER_DAY` produces LOCAL (bond.currencyCode
      // per Task-18B); each bond's contribution is anchor-normalized at source so the
      // per-corp total is well-defined when a holder owns bonds denominated in multiple
      // currencies (pre-A17 this map silently summed mixed currencies). The consumer in
      // `buildListing` converts ₳ → the holder corp's liquidCurrencyCode before folding
      // it into the income expression. (A17)
      for (const bond of allBonds) {
        if (!bond.holders || bond.holders.length === 0) continue;
        const bondCcy = (bond.currencyCode ??
          (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
            ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
            : undefined)) as CurrencyCode | undefined;
        const bondFxRate = bondCcy ? (fxByCurrencySnapshot.get(bondCcy) ?? 1) : 1;
        const couponPerUnitLocal = perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE);
        for (const h of bond.holders) {
          if (!h.corporationId) continue;
          const holderKey = h.corporationId.toString();
          const dailyLocal = couponPerUnitLocal * h.units * TURNS_PER_DAY;
          const dailyAnchor = corpCapitalToAnchor(dailyLocal, bondCcy, bondFxRate);
          bondCouponIncomeByCorpId.set(
            holderKey,
            (bondCouponIncomeByCorpId.get(holderKey) ?? 0) + dailyAnchor
          );
        }
      }

      // IMF facility cash flows (borrower payment out / lender receipts in). Only bailout corps
      // pay, only corps that own the bailout-facility pay-to corp receive. Income cap basis uses
      // the borrower's latest corporationHistory.income, matching the corporation API.
      const bailoutCorps = corporations.filter((c) => c.imfBailoutActive === true);
      if (bailoutCorps.length > 0) {
        const bailoutCorpIds = bailoutCorps.map((c) => c._id);
        const bailoutIncomeRows = await database
          .collection<{ corporationId: ObjectId; income?: number }>("corporationHistory")
          .aggregate<{ _id: ObjectId; income: number }>([
            { $match: { corporationId: { $in: bailoutCorpIds } } },
            { $sort: { turn: -1 } },
            { $group: { _id: "$corporationId", income: { $first: "$income" } } },
          ])
          .toArray();
        const bailoutIncomeById = new Map(
          bailoutIncomeRows.map((r) => [
            r._id.toString(),
            typeof r.income === "number" ? r.income : 0,
          ])
        );
        for (const bc of bailoutCorps) {
          const turnIncomeAnchor = bailoutIncomeById.get(bc._id.toString()) ?? 0;
          const paymentAnchor = imfFacilityPaymentAnchorPerTurn(bc, turnIncomeAnchor);
          const paymentDaily = anchorPerTurnToFinancialDaily(paymentAnchor);
          imfFacilityPaymentDailyByCorpId.set(bc._id.toString(), paymentDaily);
          // Receipts flow to the lender corp (imfBailoutImfCorporationId).
          const lenderId = bc.imfBailoutImfCorporationId;
          if (lenderId) {
            const lenderKey = lenderId.toString();
            imfFacilityReceiptsDailyByCorpId.set(
              lenderKey,
              (imfFacilityReceiptsDailyByCorpId.get(lenderKey) ?? 0) + paymentDaily
            );
          }
        }
      }

      for (const corp of corporations) {
        const corpKey = corp._id.toString();
        const corpSectors = allSectors.filter((s) => s.corporationId.toString() === corpKey);
        const corpBonds = allBonds.filter((b) => b.corporationId?.toString() === corpKey);

        // The per-corp income statement below runs in the corp's home currency.
        // Sector economic fields are stored in each sector's HOST-state currency,
        // so restate them into the corp's currency (host → ₳ → corp) as we read
        // them; for domestic sectors this is identity.
        const corpCode = resolveCorpLiquidCurrencyCode(corp);
        const corpRate = fxRateForCorpFromMap(corp, fxByCurrencySnapshot);
        const sectorFieldToCorpCcy = (amount: number, sector: CorporateSector): number =>
          writeCorpEconomicLocal(
            readCorpEconomicAnchor(
              amount,
              resolveSectorHostCurrencyCode(sector, corp),
              fxRateForSectorHostFromMap(sector, corp, fxByCurrencySnapshot)
            ),
            corpCode,
            corpRate
          );

        let totalRevenue = 0;
        let totalIncome = 0;
        let totalGrowth = 0;
        let growthCount = 0;
        // Per-sector profits for apportioned tax (matches corp-page math).
        // Keyed by sector _id, stored alongside revenue/country/state for later apportionment.
        const sectorProfitSamples: Array<{
          revenue: number;
          profit: number;
          countryId: string;
          stateId: string;
        }> = [];

        // Calculate daily interest cost from this corp's outstanding bonds. Each
        // bond's `(couponRate/100) × totalIssued` is LOCAL in `bond.currencyCode`
        // (Task-18B); for a corp whose `liquidCurrencyCode` matches its bonds'
        // denomination this is a safe single-currency sum, but if an admin HQ move
        // leaves the corp with legacy bonds in a different currency the raw sum
        // would mix units. Normalize per-bond to ₳, then convert ₳ → the corp's
        // own liquidCurrencyCode so the subtraction at line ~482 stays in one
        // unit with `totalIncome`.
        const annualInterestAnchor = corpBonds.reduce((sum, b) => {
          const bondCcy = (b.currencyCode ??
            (b.countryId && b.countryId in COUNTRY_CURRENCY_MAP
              ? COUNTRY_CURRENCY_MAP[b.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
              : undefined)) as CurrencyCode | undefined;
          const bondFxRate = bondCcy ? (fxByCurrencySnapshot.get(bondCcy) ?? 1) : 1;
          return (
            sum + corpCapitalToAnchor((b.couponRate / 100) * b.totalIssued, bondCcy, bondFxRate)
          );
        }, 0);
        const dailyInterestAnchor = annualInterestAnchor / (TURNS_PER_YEAR / TURNS_PER_DAY);
        const dailyInterestCost = anchorToCorpCapital(dailyInterestAnchor, corpCode, corpRate);
        bondInterestByCorpId.set(corpKey, dailyInterestCost);

        for (const sector of corpSectors) {
          const stateId = sector.stateId;
          const stateMetrics = stateMetricsById.get(stateId);
          const state = stateById.get(stateId);
          const sectorCountryId =
            sector.countryId ?? stateCountryMap.get(stateId) ?? corp.countryId;
          const corpCountryId = corp.countryId;

          // Restate the sector's stored (host-currency) fields into corp currency.
          const sectorRevenue = sectorFieldToCorpCcy(sector.revenue, sector);
          const sectorGrowthCost = sectorFieldToCorpCcy(sector.currentGrowthCost, sector);

          if (!stateMetrics || !state) {
            // Fall back to raw margin if state data is missing
            totalRevenue += sectorRevenue;
            const maintenance = sectorRevenue * (1 - sector.profitMargin / 100);
            const profit = sectorRevenue - maintenance - sectorGrowthCost;
            totalIncome += profit;
            totalGrowth += sector.targetGrowthRate ?? 0;
            growthCount++;
            sectorProfitSamples.push({
              revenue: sectorRevenue,
              profit,
              countryId: sectorCountryId,
              stateId,
            });
            continue;
          }

          // Build macro economic data for the sector's country
          const macroByCountry = new Map<
            string,
            { inflationRate: number; debtToGdpRatio: number; surplusToGdpRatio: number }
          >();
          // For now, use placeholder macro data - in production this would come from a dedicated collection
          if (!macroByCountry.has(sectorCountryId)) {
            macroByCountry.set(sectorCountryId, {
              inflationRate: 0,
              debtToGdpRatio: 0,
              surplusToGdpRatio: 0,
            });
          }
          const macroEcon = macroByCountry.get(sectorCountryId)!;

          // Calculate commodity modifiers (simplified - using global balances)
          const commodityMod = 0; // Would need full commodity balance calculation for accurate value

          // Calculate home location bonus
          const homeLocationBonus = getHomeLocationMarginBonus(
            stateId,
            corp.headquartersState,
            sectorCountryId,
            corpCountryId
          );
          const stateSectorSpecializationMod = getStateSectorSpecializationMarginBonus(
            state.sectorSpecializations,
            sector.sectorType
          );

          // Get subsidy margin modifier from all active subsidies
          const subsidyMod = getSubsidyMarginModifier(
            allSubsidies,
            corp.headquartersState,
            sector.sectorType,
            stateId,
            sector.strategyId,
            sectorCountryId,
            corpCountryId
          );

          // Get tariff modifiers (simplified - would need tariff data)
          const foreignTariffMod = 0;
          const domesticTariffMod = 0;

          // Check type switch penalty
          const typeSwitchPenaltyActive =
            corp.typeSwitchTurn != null &&
            currentTurn - corp.typeSwitchTurn < TYPE_SWITCH_PENALTY_TURNS;
          const transitionProgress =
            sector.transitionFromStrategyId && sector.transitionStartTurn != null
              ? Math.min(
                  1,
                  Math.max(
                    0,
                    (currentTurn - sector.transitionStartTurn) / STRATEGY_TRANSITION_TURNS
                  )
                )
              : 0;
          const strategyTransitionMod = 0; // Snapshot keeps strategy transition margin neutral.
          const stateMetricMargin = computeStateMetricMarginModifier({
            sectorType: sector.sectorType,
            strategyId: sector.strategyId ?? "standard",
            transitionFromStrategyId: sector.transitionFromStrategyId,
            transitionProgress,
            stateMetrics,
            countryId: sectorCountryId,
            // Live year for the era existence gate; null while the flag is off.
            year: eraYear,
            // SP4 §4a: political margin overlay for playable regions.
            politicalBaseModifiers: politicalBaseModifiersByState.get(stateId) ?? null,
          });

          // Calculate effective margin using the same function as corp page.
          // marketSharePercent is passed as 0 because this snapshot does not build
          // a per-cell market-share lookup — same trade-off as
          // queries/corporationDetail.ts. The canonical dominance penalties are
          // applied in the turn loop (sectorCalculations.ts); this snapshot's
          // aggregate income/profit will slightly over-report for monopolists
          // until the lookup is wired in. negativeProductionSustainedTurns is
          // available directly on the sector and is passed through correctly.
          const mods = computeAllMarginModifiers(
            sector.sectorType,
            sector.profitMargin,
            {
              fullMetrics: stateMetrics,
              unemploymentRate: stateMetrics.economic?.unemploymentRate?.value ?? 5,
              gridReliability: stateMetrics.infrastructure?.powerGridReliability?.value ?? 50,
              corruptionIndex: stateMetrics.governance?.corruptionIndex?.value ?? 50,
              workforceSkill: stateMetrics.education?.workforceSkill?.value ?? 5,
              crimeRate: stateMetrics.publicSafety?.crimeRate?.value ?? 50,
              broadbandAccess: stateMetrics.infrastructure?.broadbandAccess?.value ?? 50,
              roadCondition: stateMetrics.infrastructure?.roadCondition?.value ?? 50,
              carbonEmissions: stateMetrics.environment?.carbonEmissions?.value ?? 50,
              costOfLiving: stateMetrics.economic?.costOfLiving?.value ?? 50,
            },
            commodityMod,
            homeLocationBonus,
            corp.type,
            corpSectors.length,
            macroEcon,
            corp.logisticsStrength ?? 0,
            corp.secondaryType,
            typeSwitchPenaltyActive,
            foreignTariffMod,
            domesticTariffMod,
            subsidyMod,
            strategyTransitionMod,
            stateSectorSpecializationMod,
            0,
            sector.negativeProductionSustainedTurns ?? 0,
            sector.productionPolicyLevel ?? 0,
            {
              total: stateMetricMargin.cappedTotal,
              legacyTotal: stateMetricMargin.legacyTotal,
              contributions: stateMetricMargin.contributions,
              headlineModifiers: stateMetricMargin.headlineModifiers,
            },
            isStateOwned(corp)
          );

          totalRevenue += sectorRevenue;
          const maintenance = sectorRevenue * (1 - mods.effective / 100);
          const profit = sectorRevenue - maintenance - sectorGrowthCost;
          totalIncome += profit;
          totalGrowth += sector.targetGrowthRate ?? 0;
          growthCount++;
          sectorProfitSamples.push({
            revenue: sectorRevenue,
            profit,
            countryId: sectorCountryId,
            stateId,
          });
        }

        // Compute apportioned corporate tax matching the corp page formula:
        //   corpLevelCosts = marketing + logistics + CEO salary
        //   per sector: sectorNetIncome = profit − corpLevelCosts × revenueShare
        //   tax = max(0, sectorNetIncome) × (federalRate + stateRate) / 100
        const corpLevelCostsDaily =
          (corp.marketingBudget ?? 0) + (corp.logisticsBudget ?? 0) + (corp.ceoSalary ?? 0);
        let corpFederalTax = 0;
        let corpStateTax = 0;
        for (const s of sectorProfitSamples) {
          const revenueShare = totalRevenue > 0 ? s.revenue / totalRevenue : 0;
          const sectorNetIncome = s.profit - corpLevelCostsDaily * revenueShare;
          const taxable = Math.max(0, sectorNetIncome);
          if (taxable <= 0) continue;
          const isDomestic = corp.countryId === s.countryId;
          const fedRate = isDomestic
            ? (domesticFederalRateByCountry.get(s.countryId) ?? 0)
            : (foreignFederalRateByCountry.get(s.countryId) ?? 0);
          const stateRate = isDomestic
            ? (domesticStateRateByStateId.get(s.stateId) ?? 0)
            : (foreignStateRateByStateId.get(s.stateId) ?? 0);
          corpFederalTax += taxable * (fedRate / 100);
          corpStateTax += taxable * (stateRate / 100);
        }
        corporateTaxByCorpId.set(corpKey, corpFederalTax + corpStateTax);

        revenueByCorpId.set(corpKey, totalRevenue);
        // Include bond interest in income calculation to match corp page
        // Natcorps (government-owned) have bond interest covered by government subsidy
        const isNatcorp = !!corp.countryOwnerId;
        const incomeAfterBondInterest =
          totalIncome - dailyInterestCost + (isNatcorp ? dailyInterestCost : 0);
        incomeByCorpId.set(corpKey, incomeAfterBondInterest);
        growthByCorpId.set(corpKey, { total: totalGrowth, count: growthCount });
      }

      // Resolve state names
      const hqIds = [...new Set(corporations.map((c) => c.headquartersState))];
      const states = await database
        .collection<State>("states")
        .find({ _id: { $in: hqIds } })
        .project<{ _id: string; name: string }>({ _id: 1, name: 1 })
        .toArray();
      const stateNameMap = new Map(states.map((s) => [s._id, s.name]));

      function getExchange(corp: Corporation): string | null {
        // No fallback. A corp whose country has no configured venue gets null and
        // is filtered out of every per-venue snapshot below; it still appears in
        // `global`, which lists everything. The previous `?? "NYSE"` silently put
        // Soviet, East German and French state enterprises on the New York
        // exchange.
        return corp.countryId ? (getExchangeForCountry(corp.countryId) ?? null) : null;
      }

      function buildListing(corp: Corporation): StockExchangeListing {
        const ceo = corp.ceoId && !corp.ceoVacant ? ceoMap.get(corp.ceoId.toString()) : undefined;
        const corpKey = corp._id.toString();
        const totalRevenue = revenueByCorpId.get(corpKey) ?? 0;
        const sectorIncome = incomeByCorpId.get(corpKey) ?? 0;
        // Net income matches the corporation page and real-world income-statement bottom line:
        //   operating income − corporate tax + bond coupon income (− bond interest, already
        //   baked into sectorIncome via incomeByCorpId) − IMF facility payment + IMF receipts.
        const corporateTax = corporateTaxByCorpId.get(corpKey) ?? 0;
        // Coupon-income accumulator stores ₳ (A17); convert into this corp's
        // `liquidCurrencyCode` to match `sectorIncome`, the budgets, and
        // `corporateTax` before adding into the income expression.
        const bondCouponIncomeAnchor = bondCouponIncomeByCorpId.get(corpKey) ?? 0;
        const bondCouponIncome = anchorToCorpCapital(
          bondCouponIncomeAnchor,
          resolveCorpLiquidCurrencyCode(corp),
          fxRateForCorpFromMap(corp, fxByCurrencySnapshot)
        );
        const imfFacilityPaymentDaily = imfFacilityPaymentDailyByCorpId.get(corpKey) ?? 0;
        const imfFacilityReceiptsDaily = imfFacilityReceiptsDailyByCorpId.get(corpKey) ?? 0;
        const incomePreDividends =
          sectorIncome -
          corp.marketingBudget -
          (corp.logisticsBudget ?? 0) -
          (corp.ceoSalary ?? 0) -
          corporateTax +
          bondCouponIncome -
          imfFacilityPaymentDaily +
          imfFacilityReceiptsDaily;
        // Subtract the effective dividend payout so the stock-list "Income" column
        // matches the corp page hero (both post-distribution). Mirrors the turn loop's
        // effective rate (sectorCalculations.ts:735-745): honors the legal-structure
        // minimum even when corp.dividendRate is 0. Tolerate corps without a
        // resolvable legal structure (legacy / test fixtures) by falling back to the
        // CEO-set rate only.
        const dividendRateClamped = Math.min(corp.dividendRate ?? 0, MAX_DIVIDEND_RATE);
        let legalMinDividendPct = 0;
        try {
          const corpLegalStructure = getLegalStructureForCorp(corp);
          legalMinDividendPct = (corpLegalStructure.minimumDividendRate ?? 0) * 100;
        } catch {
          legalMinDividendPct = 0;
        }
        const snapshotEffectiveDividendRate =
          incomePreDividends > 0 ? Math.max(dividendRateClamped, legalMinDividendPct) : 0;
        const snapshotDividendDistribution =
          snapshotEffectiveDividendRate > 0 && incomePreDividends > 0
            ? Math.min(
                incomePreDividends * (snapshotEffectiveDividendRate / 100),
                incomePreDividends
              )
            : 0;
        const income = incomePreDividends - snapshotDividendDistribution;
        const sharePrice = getPublicShareQuote(corp);
        const totalShares = corp.totalShares ?? CEO_INITIAL_SHARES;
        const marketCap = getRoundedPublicMarketCap(corp, totalShares);
        const isNatcorp = !!corp.countryOwnerId;
        const isNpp = corp.ceoType === "npp";
        const controlling = getControllingCorporateParent(corp);
        const subsidiaryParentName = controlling
          ? corporations.find((c) => c._id.equals(controlling.corporationId))?.name
          : undefined;

        const calcSplitAdjustedPriceChange = (
          historyPoint: PriceHistoryPoint | null | undefined
        ): number => {
          if (!historyPoint || historyPoint.price <= 0) return 0;
          // Fall back to current totalShares when historical record predates the totalShares field,
          // which means no split adjustment (ratio = 1) and gives a clean price-to-price comparison.
          const historicalShares = historyPoint.totalShares ?? totalShares;
          const splitAdjustedHistoricalPrice =
            historyPoint.price * (historicalShares / totalShares);
          if (splitAdjustedHistoricalPrice <= 0) return 0;
          return (
            Math.round(
              ((sharePrice - splitAdjustedHistoricalPrice) / splitAdjustedHistoricalPrice) * 10000
            ) / 100
          );
        };

        const history = priceHistoryByCorpId.get(corp._id.toString());
        const priceChange1h = calcSplitAdjustedPriceChange(history?.h1);
        const priceChange24h = calcSplitAdjustedPriceChange(history?.h24);
        const priceChange48h = calcSplitAdjustedPriceChange(history?.h48);

        // Currency mirrors: display values render in the corp's liquidCurrencyCode
        // (UI passes the code to formatAmount so wallet preference still drives
        // rendering); anchor siblings sort + aggregate safely across corps with
        // different currencies. marketCapAnchor derives from the display
        // marketCap (the authoritative value from getRoundedPublicMarketCap) so a
        // test or consumer that overrides the market-cap quote stays consistent.
        const fx = currencyByCorpId.get(corpKey);
        const code = fx?.code;
        const rate = fx?.rate ?? 1;
        const sharePriceAnchor = readCorpEconomicAnchor(sharePrice, code, rate);
        const marketCapAnchor = Math.round(readCorpEconomicAnchor(marketCap, code, rate));
        const totalRevenueAnchor = Math.round(readCorpEconomicAnchor(totalRevenue, code, rate));
        const incomeAnchor = Math.round(readCorpEconomicAnchor(income, code, rate));

        return {
          _id: corp._id,
          sequentialId: corp.sequentialId ?? 0,
          name: corp.name,
          ...(corp.tickerSymbol ? { tickerSymbol: corp.tickerSymbol } : {}),
          type: corp.type,
          typeLabel: CORPORATION_TYPE_LABELS[corp.type],
          headquartersState: corp.headquartersState,
          headquartersStateName: stateNameMap.get(corp.headquartersState) ?? corp.headquartersState,
          logoUrl: isNatcorp
            ? (COUNTRY_CONFIGS[corp.countryOwnerId as CountryId]?.heroImage ?? corp.logoUrl)
            : corp.logoUrl,
          brandColor: corp.brandColor,
          dividendRate:
            typeof corp.dividendRate === "number" ? Math.round(corp.dividendRate * 100) / 100 : 0,
          sharePrice,
          totalShares,
          marketCap,
          totalRevenue: Math.round(totalRevenue),
          income: Math.round(income),
          liquidCurrencyCode: code ?? null,
          sharePriceAnchor,
          marketCapAnchor,
          totalRevenueAnchor,
          incomeAnchor,
          isNpp,
          ...(isNatcorp && corp.countryOwnerId ? { countryOwnerId: corp.countryOwnerId } : {}),
          priceChange1h,
          priceChange24h,
          priceChange48h,
          avgSectorGrowth: (() => {
            const g = growthByCorpId.get(corp._id.toString());
            return g && g.count > 0 ? Math.round((g.total / g.count) * 100) / 100 : 0;
          })(),
          publicFloat: corp.publicFloat ?? 0,
          exchange: getExchange(corp),
          isNatcorp,
          isSubsidiary: controlling != null,
          subsidiaryParentName,
          ceo: ceo
            ? { name: ceo.name, avatarUrl: ceo.avatarUrl, sequentialId: ceo.sequentialId }
            : null,
        };
      }

      // Load FX rates + build per-corp currency lookup. Deferred until here so
      // earlier DB-fetch ordering is untouched (simpler for the existing test
      // mocks that queue mockReturnValueOnce per collection). Values read empty
      // when the mock DB has no exchangeRates collection — rate falls back to
      // 1.0, anchor mirrors equal local values, which is the correct pre-forex
      // behavior.
      // Valuation, not settlement: this snapshot is what the market page renders and
      // what cross-corp ranking sorts on, so a currency with no rate row must fall
      // back to its authored era rate rather than to 1.0. See loadValuationFxRates.
      const fxByCurrency = await loadValuationFxRates(database);
      const currencyByCorpId = new Map<string, { code: CurrencyCode | undefined; rate: number }>();
      for (const corp of corporations) {
        currencyByCorpId.set(corp._id.toString(), {
          code: resolveCorpLiquidCurrencyCode(corp),
          rate: fxRateForCorpFromMap(corp, fxByCurrency),
        });
      }

      // Build listings for each exchange. Sort by the anchor mirror so a UK corp
      // with marketCap in GBP doesn't get ranked purely on denomination against a
      // US corp in USD — the anchor sibling gives a meaningful cross-corp order.
      const allListings = corporations.map(buildListing);
      // Player corps rank above NPP corps regardless of size (NPP corps are
      // negligible flavor, t834); within each group, sort by market-cap anchor so a
      // GBP corp isn't ranked against a USD corp purely on denomination.
      allListings.sort((a, b) => {
        if (!!a.isNpp !== !!b.isNpp) return a.isNpp ? 1 : -1;
        return (b.marketCapAnchor ?? b.marketCap) - (a.marketCapAnchor ?? a.marketCap);
      });

      // Count privately-held corps (founded but never IPO'd, or since taken
      // private) so the UI can explain absences instead of looking broken —
      // players see every founding announced on the wire ticker regardless of
      // privacy, then land on an exchange that only lists public corps.
      const privateCorpCountByExchange = new Map<string, number>();
      let totalPrivateCorpCount = 0;
      const privateCorpRows = await database
        .collection<Corporation>("corporations")
        .aggregate<{ _id: string | null; count: number }>([
          { $match: { hiddenFromExchange: { $ne: true }, isPrivate: true } },
          { $group: { _id: "$countryId", count: { $sum: 1 } } },
        ])
        .toArray();
      for (const row of privateCorpRows) {
        totalPrivateCorpCount += row.count;
        const exchangeName = row._id ? getExchangeForCountry(row._id) : undefined;
        if (exchangeName) {
          privateCorpCountByExchange.set(
            exchangeName,
            (privateCorpCountByExchange.get(exchangeName) ?? 0) + row.count
          );
        }
      }

      // Build per-exchange snapshots dynamically from registry
      const snapshots: StockExchangeSnapshot[] = ALL_EXCHANGES.map((ex) => ({
        _id: ex.apiKey,
        turn: currentTurn,
        exchangeName: ex.exchangeName,
        listings: allListings.filter((l) => l.exchange === ex.exchangeName),
        unlistedPrivateCount: privateCorpCountByExchange.get(ex.exchangeName) ?? 0,
        createdAt: now,
      }));
      // Add global snapshot
      snapshots.push({
        _id: "global",
        turn: currentTurn,
        exchangeName: EXCHANGE_NAMES.global ?? "Global Markets",
        listings: allListings,
        unlistedPrivateCount: totalPrivateCorpCount,
        createdAt: now,
      });

      // Upsert all snapshots
      const collection = database.collection<StockExchangeSnapshot>("stockExchangeSnapshots");
      await Promise.all(
        snapshots.map((snapshot) =>
          collection.updateOne({ _id: snapshot._id }, { $set: snapshot }, { upsert: true })
        )
      );
    }
  );
}

// Re-exported from their new home so existing import paths keep working
// (turnPhaseRegistry, admin debug route, tests import these from this module).
export {
  generateInvestorRankingSnapshot,
  generateWealthListSnapshots,
} from "./investorWealthSnapshots";

import { loadWorkforceSkillByState } from "@/lib/politicalLegislation/workforceSkillLoader";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_FINANCIAL_LIMITS } from "@/lib/api/rateLimit";
import { toAbsoluteUploadUrl } from "@/lib/discord";
import type {
  Corporation,
  CorporateSector,
  State,
  StateMetrics,
  Bond,
  CentralBank,
} from "@/lib/db/types";
import type { Character } from "@/lib/db/types/character";
import { bulkFetchCharacterNames } from "@/lib/db/characterLookup";
import {
  CORPORATION_TYPE_LABELS,
  getUnemploymentMarginModifier,
  getStateSectorSpecializationMarginBonus,
  calculateWorkers,
  TURNS_PER_DAY,
  NPV_ANNUAL_DISCOUNT_RATE,
  MAX_DIVIDEND_RATE,
} from "@/lib/constants/corporations";
import { getLegalStructureForCorp } from "@/lib/corporations/legalStructure";
import { loadCorporationDetailView } from "@/lib/corporations/queries/corporationDetail";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { BOND_MATURITY_LABELS } from "@/lib/db/types/bond";
import type { BondMaturityTurns } from "@/lib/db/types/bond";
import {
  calculateBondYieldToMaturityPercent,
  calculateCreditScore,
  getBondCouponRate,
} from "@/lib/constants/bonds";
import { isBondDefaultCreditPenaltyActive } from "@/lib/bonds/corporateBondDefault";
import { getCountryConfig } from "@/lib/constants/countries";
import { getGameState } from "@/lib/gameState";
import { getRoundedPublicMarketCap } from "@/lib/corporations/marketQuote";
import { sectorEconomicRevenue } from "@/lib/corporations/sectorRevenueBasis";
import {
  anchorToCorpCapital,
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

// GET /api/discord-bot/financials — Returns a detailed financial statement for a corporation by name, including income statement, balance sheet, and credit rating.
// Auth: requireAdminOrApiKey
// Errors: 400, 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:financials",
      BOT_FINANCIAL_LIMITS.maxRequests,
      BOT_FINANCIAL_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const url = new URL(request.url);
    const name = url.searchParams.get("name");

    if (!name) {
      return NextResponse.json({ error: "Must provide ?name=<corpName>" }, { status: 400 });
    }

    const db = await getDb();

    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const corporation = await db
      .collection<Corporation>("corporations")
      .findOne({ name: { $regex: new RegExp(`^${escapedName}$`, "i") } });

    if (!corporation) {
      return NextResponse.json({ found: false });
    }

    const [ceo, sectors, outstandingBonds, gameState] = await Promise.all([
      db
        .collection<Character>("characters")
        .findOne({ _id: corporation.ceoId }, { projection: { name: 1, sequentialId: 1 } }),
      db
        .collection<CorporateSector>("corporateSectors")
        .find({ corporationId: corporation._id })
        .toArray(),
      db
        .collection<Bond>("bonds")
        .find({ corporationId: corporation._id, matured: false })
        .sort({ createdAt: -1 })
        .toArray(),
      getGameState(),
    ]);

    const currentTurn = gameState?.currentTurn ?? 1;

    // Source the income statement from the SAME shared builder the website uses
    // so the "Financial Statement" embed matches the corp page (ticket #970).
    // The builder returns daily-unit, corp-LOCAL figures — the same units the
    // fields below already use — and folds in the engine's realized income when
    // a corporationHistory row exists. `viewerUserId: null` = public view.
    const detail = await loadCorporationDetailView({
      db,
      corporation,
      currentTurn,
      viewerUserId: null,
    });
    const f = detail.financials;
    // Headline net income mirrors the website: prefer engine-realized income
    // when present, else the projected income (SummaryBand.tsx).
    const netIncome = typeof f.realizedIncome === "number" ? f.realizedIncome : f.income;

    // State data
    const allStateIds = [corporation.headquartersState, ...sectors.map((s) => s.stateId)];
    const uniqueStateIds = [...new Set(allStateIds)];
    const [states, stateMetricsDocs] =
      uniqueStateIds.length > 0
        ? await Promise.all([
            db
              .collection<State>("states")
              .find({ _id: { $in: uniqueStateIds } })
              .project<Pick<State, "_id" | "name" | "sectorSpecializations">>({
                _id: 1,
                name: 1,
                sectorSpecializations: 1,
              })
              .toArray(),
            // SP5: unemployment lives on macroMetrics (workforceSkill flows
            // through loadWorkforceSkillByState separately).
            db
              .collection<StateMetrics>("macroMetrics")
              .find(
                { _id: { $in: uniqueStateIds } },
                { projection: { "economic.unemploymentRate.value": 1 } }
              )
              .toArray(),
          ])
        : [[], []];

    const stateNameMap = new Map(states.map((s) => [s._id, s.name]));
    const stateSpecializationMap = new Map(states.map((s) => [s._id, s.sectorSpecializations]));
    const unemploymentModMap = new Map(
      stateMetricsDocs.map((sm) => [
        String(sm._id),
        getUnemploymentMarginModifier(sm.economic?.unemploymentRate?.value),
      ])
    );
    // SP4: merged legacy + political-board read so playable regions' worker
    // counts keep matching the turn's adapter-fed values.
    const workforceSkillMap = await loadWorkforceSkillByState(db, uniqueStateIds);

    // ── Sector breakdown (per-sector display rows) ──────────────────────────
    // The aggregate income statement below is sourced from the shared builder
    // (`f`); these per-sector rows keep their own margin/maintenance/profit
    // figures for the sector-detail section of the embed.
    const sectorBreakdown = sectors.map((sector) => {
      const unemploymentMod = unemploymentModMap.get(sector.stateId) ?? 0;
      const stateSectorSpecializationMod = getStateSectorSpecializationMarginBonus(
        stateSpecializationMap.get(sector.stateId),
        sector.sectorType
      );
      const effectiveMargin = Math.max(
        0,
        Math.min(100, sector.profitMargin + unemploymentMod + stateSectorSpecializationMod)
      );
      const maintenance = sector.revenue * (1 - effectiveMargin / 100);
      const profit = sector.revenue - maintenance - sector.currentGrowthCost;

      return {
        stateId: sector.stateId,
        stateName: stateNameMap.get(sector.stateId) ?? sector.stateId,
        revenue: Math.round(sector.revenue),
        maintenanceCost: Math.round(maintenance),
        growthCost: Math.round(sector.currentGrowthCost),
        profit: Math.round(profit),
        effectiveMargin: Math.round(effectiveMargin * 10) / 10,
        currentGrowthRate: sector.currentGrowthRate ?? sector.growthRate ?? 0,
        workers: calculateWorkers(sector.revenue, workforceSkillMap.get(sector.stateId) ?? null),
      };
    });

    const ceoSalary = corporation.ceoSalary ?? 0;
    // Bond debt + interest per-bond anchor-normalization (A30 mirror on
    // discord-bot). `b.totalIssued` + `(couponRate/100) × totalIssued` are
    // LOCAL in `bond.currencyCode`; for same-currency issuers the sum is
    // safe, but admin-relocated corps with legacy cross-currency bonds
    // would mix denominations. Normalize per-bond → ₳ → convert to corp
    // LOCAL for the income statement (all display fields land in corp
    // LOCAL to match `totalRevenue` / `operatingCosts`).
    const fxByCurrency = await loadFxRatesByCurrency(db);
    const corpCurrency = resolveCorpLiquidCurrencyCode(corporation);
    const corpFxRate = fxRateForCorpFromMap(corporation, fxByCurrency);
    const totalDebtAnchor = outstandingBonds.reduce((sum, b) => {
      const bondCcy = (b.currencyCode ??
        (b.countryId && b.countryId in COUNTRY_CURRENCY_MAP
          ? COUNTRY_CURRENCY_MAP[b.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
          : undefined)) as CurrencyCode | undefined;
      const bondFxRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
      return sum + corpCapitalToAnchor(b.totalIssued, bondCcy, bondFxRate);
    }, 0);
    const annualInterestAnchor = outstandingBonds.reduce((sum, b) => {
      const bondCcy = (b.currencyCode ??
        (b.countryId && b.countryId in COUNTRY_CURRENCY_MAP
          ? COUNTRY_CURRENCY_MAP[b.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
          : undefined)) as CurrencyCode | undefined;
      const bondFxRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
      return sum + corpCapitalToAnchor((b.couponRate / 100) * b.totalIssued, bondCcy, bondFxRate);
    }, 0);
    const GAME_DAYS_PER_YEAR = TURNS_PER_YEAR / TURNS_PER_DAY;
    const dailyInterestAnchor = annualInterestAnchor / GAME_DAYS_PER_YEAR;
    const totalDebt = anchorToCorpCapital(totalDebtAnchor, corpCurrency, corpFxRate);
    const annualInterest = anchorToCorpCapital(annualInterestAnchor, corpCurrency, corpFxRate);
    const dailyInterestCost = anchorToCorpCapital(dailyInterestAnchor, corpCurrency, corpFxRate);

    // Income statement — sourced entirely from the shared builder (`f`) so the
    // bot matches the website. `income` is the realized-or-projected net income
    // and drives dividends, retained earnings and the credit-rating input below.
    const logisticsBudget = corporation.logisticsBudget ?? 0;
    const operatingCosts = f.operatingCosts;
    const operatingIncome = f.operatingIncome;
    const totalCosts = f.totalCosts;
    const income = netIncome;

    // Honor legal-structure minimum payout (matches sectorCalculations.ts:735-745).
    const corpDividendRateClamped = Math.min(corporation.dividendRate ?? 0, MAX_DIVIDEND_RATE);
    let legalMinDividendPct = 0;
    try {
      legalMinDividendPct = (getLegalStructureForCorp(corporation).minimumDividendRate ?? 0) * 100;
    } catch {
      legalMinDividendPct = 0;
    }
    const dividendRate = income > 0 ? Math.max(corpDividendRateClamped, legalMinDividendPct) : 0;
    const dailyDividendPayout = income > 0 ? Math.round((income * dividendRate) / 100) : 0;
    const retainedEarnings = Math.round(income - dailyDividendPayout);

    const incomeStatement = {
      totalRevenue: Math.round(f.totalRevenue),
      costs: {
        maintenance: Math.round(f.maintenanceCosts),
        growth: Math.round(f.growthCosts),
        marketing: f.marketingCosts,
        logistics: logisticsBudget,
        ceoSalary,
        operatingTotal: Math.round(operatingCosts),
        bondInterest: Math.round(f.bondInterestCost),
        grandTotal: Math.round(totalCosts),
      },
      operatingIncome: Math.round(operatingIncome),
      netIncome: Math.round(income),
      dividendRate,
      dailyDividendPayout,
      retainedEarnings,
    };

    // ── Balance Sheet ───────────────────────────────────────────────────────
    let totalSectorNPV = 0;
    for (const sector of sectors) {
      const unemploymentMod = unemploymentModMap.get(sector.stateId) ?? 0;
      const stateSectorSpecializationMod = getStateSectorSpecializationMarginBonus(
        stateSpecializationMap.get(sector.stateId),
        sector.sectorType
      );
      const effMargin = Math.max(
        0,
        Math.min(100, sector.profitMargin + unemploymentMod + stateSectorSpecializationMod)
      );
      const sectorRevenue = sectorEconomicRevenue(sector);
      const maint = sectorRevenue * (1 - effMargin / 100);
      const profit = sectorRevenue - maint - sector.currentGrowthCost;
      const yearlyProfit = profit * GAME_DAYS_PER_YEAR;
      if (yearlyProfit > 0) totalSectorNPV += Math.round(yearlyProfit / NPV_ANNUAL_DISCOUNT_RATE);
    }

    const totalAssets = Math.round(corporation.liquidCapital) + totalSectorNPV;
    const bookValue = totalAssets - totalDebt;

    const balanceSheet = {
      assets: {
        cashOnHand: Math.round(corporation.liquidCapital),
        sectorNPV: totalSectorNPV,
        totalAssets,
      },
      liabilities: {
        outstandingDebt: Math.round(totalDebt),
        bondCount: outstandingBonds.length,
        annualInterestObligation: Math.round(annualInterest),
        dailyInterestCost: Math.round(dailyInterestCost),
      },
      equity: {
        bookValue: Math.round(bookValue),
      },
    };

    // ── Share Structure ─────────────────────────────────────────────────────
    const totalShares = corporation.totalShares ?? 10_000_000;
    const publicFloat = corporation.publicFloat ?? 0;
    const listedSharePrice = Math.round((corporation.sharePrice ?? 0.1) * 100) / 100;
    const marketCap = getRoundedPublicMarketCap(corporation, totalShares);

    // Shareholders
    const shareholderIds = (corporation.shareholders ?? [])
      .map((sh) => sh.characterId)
      .filter((id): id is ObjectId => id !== undefined);
    const shareholderNameMap = await bulkFetchCharacterNames(db, shareholderIds);

    const shareholders = (corporation.shareholders ?? [])
      .filter((sh): sh is typeof sh & { characterId: ObjectId } => sh.characterId !== undefined)
      .map((sh) => ({
        name: shareholderNameMap.get(sh.characterId.toString())?.name ?? "Unknown",
        shares: sh.shares,
        percentage: Math.round((sh.shares / totalShares) * 10000) / 100,
        value: Math.round(sh.shares * listedSharePrice),
      }))
      .sort((a, b) => b.shares - a.shares);

    const shareStructure = {
      totalShares,
      publicFloat,
      publicFloatPct: Math.round((publicFloat / totalShares) * 10000) / 100,
      sharePrice: listedSharePrice,
      marketCapitalization: marketCap,
      shareholders,
    };

    // ── Credit Rating ───────────────────────────────────────────────────────
    const creditRating = calculateCreditScore(
      corporation.liquidCapital,
      totalDebt,
      income * GAME_DAYS_PER_YEAR,
      annualInterest,
      totalAssets,
      {
        bondDefaultCreditPenaltyActive: isBondDefaultCreditPenaltyActive(corporation, currentTurn),
      }
    );

    const countryId = corporation.countryId;
    // getBankId: shared-bank members (IE → ECB) have no doc under their own id.
    const centralBank = await db
      .collection<CentralBank>("centralBanks")
      .findOne({ _id: getBankId(countryId) });
    const primeRate =
      centralBank?.primeRate ?? getCountryConfig(countryId).centralBank.defaultPrimeRate;
    const effectiveCouponRate = getBondCouponRate(primeRate, creditRating.rating);

    // ── Bond Details ────────────────────────────────────────────────────────
    const bondDetails = outstandingBonds.map((b) => {
      const turnsRemaining = Math.max(0, b.maturityTurn - currentTurn);
      return {
        id: b._id.toString(),
        bondUrl: `${BASE_URL}/bond/${b._id}`,
        couponRate: b.couponRate,
        maturityLabel:
          BOND_MATURITY_LABELS[b.maturityTurns as BondMaturityTurns] ?? `${b.maturityTurns} turns`,
        totalIssued: b.totalIssued,
        marketPrice: b.marketPrice,
        turnsRemaining,
        yieldToMaturity:
          Math.round(
            calculateBondYieldToMaturityPercent(b.couponRate, b.marketPrice, turnsRemaining) * 100
          ) / 100,
        holders: b.holders.length,
        defaulted: b.defaulted,
      };
    });

    const corpUrl = corporation.sequentialId
      ? `${BASE_URL}/corporation/${corporation.sequentialId}`
      : `${BASE_URL}/corporation/${corporation._id}`;

    return NextResponse.json({
      found: true,
      corporation: {
        name: corporation.name,
        type: corporation.type,
        typeLabel: CORPORATION_TYPE_LABELS[corporation.type],
        brandColor: corporation.brandColor ?? null,
        // Absolutise relative upload paths so Discord embeds can fetch them.
        logoUrl: toAbsoluteUploadUrl(corporation.logoUrl, BASE_URL),
        headquartersStateName:
          stateNameMap.get(corporation.headquartersState) ?? corporation.headquartersState,
        ceo: ceo && !corporation.ceoVacant ? ceo.name : "Vacant",
        corpUrl,
        countryId: corporation.countryId,
        // incomeStatement, balanceSheet, shareStructure and bonds all denominate
        // in this currency (v0.2.6). Bot formatters pair numbers with this code.
        liquidCurrencyCode: corporation.liquidCurrencyCode ?? null,
      },
      incomeStatement,
      balanceSheet,
      shareStructure,
      creditRating: {
        rating: creditRating.rating,
        compositeScore: creditRating.compositeScore,
        components: creditRating.components,
        effectiveCouponRate,
        primeRate,
      },
      bonds: bondDetails,
      sectorBreakdown,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

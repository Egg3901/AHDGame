import { loadWorkforceSkillByState } from "@/lib/politicalLegislation/workforceSkillLoader";
import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import type { Corporation, CorporateSector, State, StateMetrics, Bond } from "@/lib/db/types";
import type { Character } from "@/lib/db/types/character";
import { bulkFetchCharacterNames } from "@/lib/db/characterLookup";
import { toAbsoluteUploadUrl } from "@/lib/discord";
import {
  CORPORATION_TYPE_LABELS,
  calcMarketingGrowth,
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
import { calculateCreditScore, getBondCouponRate } from "@/lib/constants/bonds";
import { isBondDefaultCreditPenaltyActive } from "@/lib/bonds/corporateBondDefault";
import type { CentralBank } from "@/lib/db/types";
import { getCountryConfig } from "@/lib/constants/countries";
import { getGameState } from "@/lib/gameState";
import { getPublicShareQuote, getRoundedPublicMarketCap } from "@/lib/corporations/marketQuote";
import { sectorEconomicRevenue } from "@/lib/corporations/sectorRevenueBasis";
import { roundMarketingStrength } from "@/lib/utils/formatters";
import {
  anchorToCorpCapital,
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  fxRateForSectorHostFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";
const LIST_CACHE_HEADERS = {
  "Cache-Control": "private, max-age=60, no-transform",
};
const DETAIL_CACHE_HEADERS = {
  "Cache-Control": "private, max-age=30, no-transform",
};

// ── List builder ────────────────────────────────────────────────────────────
async function buildCorpList(): Promise<{
  corporations: { id: string; name: string }[];
}> {
  const db = await getDb();
  const corps = await db
    .collection<Corporation>("corporations")
    .find({})
    .project<{ _id: ObjectId; name: string }>({ _id: 1, name: 1 })
    .sort({ name: 1 })
    .toArray();

  return {
    corporations: corps.map((c) => ({ id: c._id.toString(), name: c.name })),
  };
}

const getCachedCorpList = unstable_cache(buildCorpList, ["discord-bot:corp-list"], {
  revalidate: 60,
  tags: ["discord-bot:corp-list"],
});

// ── Detail builder ──────────────────────────────────────────────────────────
type CorpDetailPayload =
  | { found: false }
  | {
      found: true;
      corporation: Record<string, unknown>;
      ceo: { name: string; profileUrl: string | null } | null;
      shareholders: { name: string; shares: number; percentage: number }[];
      financials: Record<string, number>;
      balanceSheet: Record<string, number>;
      creditRating: { rating: string; compositeScore: number; effectiveCouponRate: number };
      bonds: Record<string, unknown>[];
      sectors: Record<string, unknown>[];
    };

async function buildCorpDetail(nameLower: string): Promise<CorpDetailPayload> {
  const db = await getDb();

  // Find corporation by exact name (case-insensitive). The cache key is the
  // lowercased name, so two callers asking for the same corp share output.
  const escapedName = nameLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const corporation = await db
    .collection<Corporation>("corporations")
    .findOne({ name: { $regex: new RegExp(`^${escapedName}$`, "i") } });

  if (!corporation) {
    return { found: false };
  }

  // Fetch CEO, sectors, bonds, game state in parallel
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

  // Source the income statement from the SAME shared builder the website uses,
  // so the bot embed matches the corp page by construction (ticket #970). The
  // builder returns daily-unit, corp-LOCAL figures — the same units the fields
  // below already use — and folds in the engine's realized income when a
  // corporationHistory row exists. `viewerUserId: null` = public view (no
  // request-scoped auth needed). We only take `financials` here; the sectors,
  // bonds, balance-sheet and credit sections keep their existing computations.
  const detail = await loadCorporationDetailView({
    db,
    corporation,
    currentTurn,
    viewerUserId: null,
  });
  const f = detail.financials;
  // Headline net income mirrors the website: prefer engine-realized income when
  // present, else the projected income (SummaryBand.tsx / CeoCommandStrip.tsx).
  const netIncome = typeof f.realizedIncome === "number" ? f.realizedIncome : f.income;

  // Resolve state names and unemployment for financial calculations
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
          db
            // SP5: unemployment lives on macroMetrics (workforceSkill flows
            // through loadWorkforceSkillByState separately).
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

  const ceoSalary = corporation.ceoSalary ?? 0;

  // Bond debt/interest — still needed for the balance-sheet and credit-rating
  // sections (the income-statement interest line now comes from `f`). Per-bond
  // anchor-normalize then convert to corp LOCAL (A30 mirror). Same-currency
  // issuers collapse to the raw sum; cross-currency bonds are handled correctly.
  const fxByCurrency = await loadFxRatesByCurrency(db);
  const corpCurrency = resolveCorpLiquidCurrencyCode(corporation);
  const corpFxRate = fxRateForCorpFromMap(corporation, fxByCurrency);

  // Sector economic fields are stored in each sector's HOST-market currency,
  // not the owning corp's — same shape as the web sector-detail currency bug
  // fixed in #3540. Normalize host -> ₳ (for currency-invariant math, e.g.
  // workers) and host -> corp currency (for anything displayed as money).
  const sectorAmountAnchor = (amount: number, sector: CorporateSector) =>
    readCorpEconomicAnchor(
      amount,
      resolveSectorHostCurrencyCode(sector, corporation),
      fxRateForSectorHostFromMap(sector, corporation, fxByCurrency)
    );

  // Sector display rows. The income statement is sourced from `f` (shared
  // builder) above, so the hand-rolled per-sector revenue/maintenance
  // accumulation that used to live here is gone; only display fields remain.
  // Prefer realized revenue over nameplate (sectorEconomicRevenue, #3001/#3002,
  // same basis the balance-sheet loop below and the website already use).
  const sectorDetails = sectors.map((sector) => {
    const economicRevenue = sectorEconomicRevenue(sector);
    const revenueAnchor = sectorAmountAnchor(economicRevenue, sector);
    return {
      stateId: sector.stateId,
      stateName: stateNameMap.get(sector.stateId) ?? sector.stateId,
      revenue: Math.round(writeCorpEconomicLocal(revenueAnchor, corpCurrency, corpFxRate)),
      currentGrowthRate: sector.currentGrowthRate ?? sector.growthRate ?? 0,
      workers: calculateWorkers(revenueAnchor, workforceSkillMap.get(sector.stateId) ?? null),
    };
  });
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
  const totalDebt = anchorToCorpCapital(totalDebtAnchor, corpCurrency, corpFxRate);
  const annualInterest = anchorToCorpCapital(annualInterestAnchor, corpCurrency, corpFxRate);

  // Income statement — sourced entirely from the shared builder (`f`) so the
  // bot matches the website. `income` is the realized-or-projected net income
  // and flows to dividends, retained earnings and the credit-rating input below.
  const logisticsBudget = corporation.logisticsBudget ?? 0;
  const operatingCosts = f.operatingCosts;
  const operatingIncome = f.operatingIncome;
  const totalCosts = f.totalCosts;
  const income = netIncome;

  const marketingStrengthGrowth = calcMarketingGrowth(
    corporation.marketingBudget,
    corporation.marketingStrength ?? 0
  );

  const totalShares = corporation.totalShares ?? 10_000_000;
  const marketCapitalization = getRoundedPublicMarketCap(corporation, totalShares);
  const listedSharePrice = Math.round(getPublicShareQuote(corporation) * 100) / 100;

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
    }))
    .sort((a, b) => b.shares - a.shares);

  const publicFloat = corporation.publicFloat ?? 0;
  const publicFloatPct = Math.round((publicFloat / totalShares) * 10000) / 100;

  // Dividends — honor legal-structure minimum payout (matches turn loop).
  const corpDividendRateClamped = Math.min(corporation.dividendRate ?? 0, MAX_DIVIDEND_RATE);
  let legalMinDividendPct = 0;
  try {
    legalMinDividendPct = (getLegalStructureForCorp(corporation).minimumDividendRate ?? 0) * 100;
  } catch {
    legalMinDividendPct = 0;
  }
  const dividendRate = income > 0 ? Math.max(corpDividendRateClamped, legalMinDividendPct) : 0;
  const dailyDividendPayout = income > 0 ? Math.round((income * dividendRate) / 100) : 0;

  // Balance sheet (simplified — use per-sector raw data for NPV). Sectors can
  // span multiple host currencies for one corp, so per-sector profit is
  // computed in anchor (₳) units before being summed — mixing raw host-currency
  // figures across sectors here would silently misstate the total.
  let totalSectorNPVAnchor = 0;
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
    const sectorRevenueAnchor = sectorAmountAnchor(sectorEconomicRevenue(sector), sector);
    const growthCostAnchor = sectorAmountAnchor(sector.currentGrowthCost, sector);
    const maint = sectorRevenueAnchor * (1 - effMargin / 100);
    const profit = sectorRevenueAnchor - maint - growthCostAnchor;
    const yearlyProfit = profit * GAME_DAYS_PER_YEAR;
    if (yearlyProfit > 0) totalSectorNPVAnchor += yearlyProfit / NPV_ANNUAL_DISCOUNT_RATE;
  }
  const totalSectorNPV = Math.round(
    writeCorpEconomicLocal(totalSectorNPVAnchor, corpCurrency, corpFxRate)
  );
  const totalAssets = Math.round(corporation.liquidCapital) + totalSectorNPV;
  const bookValue = totalAssets - totalDebt;

  // Credit rating
  const annualIncome = income * GAME_DAYS_PER_YEAR;
  const totalEquity = Math.round(corporation.liquidCapital) + totalSectorNPV;
  const creditRating = calculateCreditScore(
    corporation.liquidCapital,
    totalDebt,
    annualIncome,
    annualInterest,
    totalEquity,
    {
      bondDefaultCreditPenaltyActive: isBondDefaultCreditPenaltyActive(corporation, currentTurn),
    }
  );

  // Prime rate for coupon
  const countryId = corporation.countryId;
  // getBankId: shared-bank members (IE → ECB) have no doc under their own id.
  const centralBank = await db
    .collection<CentralBank>("centralBanks")
    .findOne({ _id: getBankId(countryId) });
  const primeRate =
    centralBank?.primeRate ?? getCountryConfig(countryId).centralBank.defaultPrimeRate;
  const effectiveCouponRate = getBondCouponRate(primeRate, creditRating.rating);

  // Bonds summary
  const bondsSummary = outstandingBonds.map((b) => ({
    id: b._id.toString(),
    couponRate: b.couponRate,
    maturityLabel:
      BOND_MATURITY_LABELS[b.maturityTurns as BondMaturityTurns] ?? `${b.maturityTurns} turns`,
    totalIssued: b.totalIssued,
    marketPrice: b.marketPrice,
    turnsRemaining: Math.max(0, b.maturityTurn - currentTurn),
    defaulted: b.defaulted,
  }));

  const corpUrl = corporation.sequentialId
    ? `${BASE_URL}/corporation/${corporation.sequentialId}`
    : `${BASE_URL}/corporation/${corporation._id}`;

  const ceoUrl = ceo ? `${BASE_URL}/character/${ceo.sequentialId ?? ceo._id}` : null;

  return {
    found: true,
    corporation: {
      id: corporation._id.toString(),
      sequentialId: corporation.sequentialId,
      name: corporation.name,
      description: corporation.description ?? null,
      type: corporation.type,
      typeLabel: CORPORATION_TYPE_LABELS[corporation.type],
      brandColor: corporation.brandColor ?? null,
      // Absolutise relative upload paths so Discord embeds can fetch them.
      logoUrl: toAbsoluteUploadUrl(corporation.logoUrl, BASE_URL),
      headquartersState: corporation.headquartersState,
      headquartersStateName:
        stateNameMap.get(corporation.headquartersState) ?? corporation.headquartersState,
      liquidCapital: Math.round(corporation.liquidCapital),
      sharePrice: listedSharePrice,
      totalShares,
      publicFloat,
      publicFloatPct,
      marketCapitalization: Math.round(marketCapitalization),
      marketingBudget: corporation.marketingBudget,
      marketingStrength: roundMarketingStrength(corporation.marketingStrength),
      marketingStrengthGrowth: Math.round(marketingStrengthGrowth * 1000) / 1000,
      ceoSalary,
      dividendRate,
      corpUrl,
      countryId: corporation.countryId,
      // All money fields above (liquidCapital, sharePrice, marketCapitalization,
      // marketingBudget, ceoSalary, financials.*, balanceSheet.*) are denominated
      // in this currency. Bot formatters should pair the number with this code.
      liquidCurrencyCode: corporation.liquidCurrencyCode ?? null,
    },
    ceo: ceo && !corporation.ceoVacant ? { name: ceo.name, profileUrl: ceoUrl } : null,
    shareholders,
    financials: {
      totalRevenue: Math.round(f.totalRevenue),
      maintenanceCosts: Math.round(f.maintenanceCosts),
      growthCosts: Math.round(f.growthCosts),
      marketingCosts: f.marketingCosts,
      logisticsCosts: Math.round(logisticsBudget),
      ceoSalaryCost: ceoSalary,
      operatingCosts: Math.round(operatingCosts),
      operatingIncome: Math.round(operatingIncome),
      bondInterestCost: Math.round(f.bondInterestCost),
      totalCosts: Math.round(totalCosts),
      income: Math.round(income),
      dailyDividendPayout,
      retainedEarnings: Math.round(income - dailyDividendPayout),
    },
    balanceSheet: {
      totalAssets,
      cashOnHand: Math.round(corporation.liquidCapital),
      sectorNPV: totalSectorNPV,
      totalDebt: Math.round(totalDebt),
      bookValue: Math.round(bookValue),
      // Subtract debt from displayed equity to match the website API and the
      // turn-system share-price formula. Natcorps exempt (sovereign-backed).
      // Note: `totalEquity` above is the credit-rating input (cash+NPV only),
      // intentionally distinct from the balance-sheet equity exposed here.
      totalEquity: Math.round(totalEquity - (corporation.countryOwnerId ? 0 : totalDebt)),
      marketCapitalization: Math.round(marketCapitalization),
    },
    creditRating: {
      rating: creditRating.rating,
      compositeScore: creditRating.compositeScore,
      effectiveCouponRate,
    },
    bonds: bondsSummary,
    sectors: sectorDetails,
  };
}

const getCachedCorpDetail = unstable_cache(buildCorpDetail, ["discord-bot:corp-detail"], {
  revalidate: 30,
  tags: ["discord-bot:corp-detail"],
});

// GET /api/discord-bot/corporation — Returns full corporation detail by name, or a list of all corporation names when ?list=true.
// Auth: requireBotToken
// Errors: 400, 401, 429
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:corporation",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const url = new URL(request.url);
    const listMode = url.searchParams.get("list") === "true";
    const name = url.searchParams.get("name");

    if (listMode) {
      const data = await getCachedCorpList();
      return NextResponse.json(data, { headers: LIST_CACHE_HEADERS });
    }

    if (!name) {
      return NextResponse.json({ error: "Must provide name or list=true" }, { status: 400 });
    }

    const detail = await getCachedCorpDetail(name.toLowerCase());
    return NextResponse.json(detail, { headers: DETAIL_CACHE_HEADERS });
  } catch (error) {
    return handleRouteError(error);
  }
}

import type { Db } from "mongodb";
import type { Corporation, ShareListing, ShareOrder } from "@/lib/db/types";
import {
  indexFundOwnershipFraction,
  qualifiesForIndexInclusionBenefit,
} from "@/lib/corporations/indexOwnership";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import { getEraFounderShares } from "@/lib/constants/sectorSeedEra";
import { caretakerReappointCooldownRemaining } from "@/lib/corporations/caretakerCeo";
import {
  CORPORATION_TYPE_LABELS,
  SHARE_STRUCTURE_COOLDOWN_TURNS,
  SHARE_CONSOLIDATION_MIN_TOTAL_SHARES,
  CEO_INITIAL_SHARES,
} from "@/lib/constants/corporations";
import {
  corporationWithReservedHoldings,
  reservedCorporatePositions,
} from "@/lib/corporations/reservedCorporateHoldings";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { getTurnReferenceData } from "@/lib/corporations/turnReferenceData";
import { roundMarketingStrength } from "@/lib/utils/formatters";
import { loadEquityQuote } from "@/lib/equities/marketPool";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { buildSectorCurrencyRestatement } from "./corporationDetail/currencyRestatement";
import { computeRevenueRealizationRatio } from "./corporationDetail/realizationRatio";
import { buildBrandLoyaltyFields } from "./corporationDetail/brandLoyalty";
import { loadCeoViewFlags } from "./corporationDetail/ceoView";
import { loadReferenceSectors } from "./corporationDetail/referenceSectors";
import { loadStateViewContext } from "./corporationDetail/stateViewContext";
import { loadMarketViewContext } from "./corporationDetail/marketViewContext";
import { buildSectorDetails, loadSectorModeFlags } from "./corporationDetail/sectorRows";
import { loadPortfolioHoldings } from "./corporationDetail/portfolioHoldings";
import { computeIncomeStatement } from "./corporationDetail/incomeStatement";
import { loadSubsidiaryContext } from "./corporationDetail/subsidiaryContext";
import { buildFinancials } from "./corporationDetail/financials";
import { buildShareholderList, loadShareholderContext } from "./corporationDetail/shareholders";
import { buildPhysicalPnl } from "./corporationDetail/physicalPnl";

export async function loadCorporationDetailView(args: {
  db: Db;
  corporation: Corporation;
  currentTurn: number;
  viewerUserId?: string | null;
}) {
  const { db, corporation, currentTurn, viewerUserId } = args;

  const refDataPromise = getTurnReferenceData(db, currentTurn);
  const equityQuotePromise = loadEquityQuote(db, corporation);
  const bankingPolicyPromise = corporation.bankCharter
    ? loadBankingPolicy(db)
    : Promise.resolve(null);

  const [openListingsForInvariant, openSellOrdersForInvariant] = await Promise.all([
    db
      .collection<ShareListing>("shareListings")
      .find({ corporationId: corporation._id, status: "open" })
      .toArray(),
    db
      .collection<ShareOrder>("shareOrders")
      .find({
        corporationId: corporation._id,
        type: "sell",
        status: "open",
        placerCorporationId: { $exists: true },
      })
      .toArray(),
  ]);
  const reservedHoldings = reservedCorporatePositions(
    openSellOrdersForInvariant,
    openListingsForInvariant,
    corporation._id
  );
  const corporationForControl = corporationWithReservedHoldings(corporation, reservedHoldings);

  const shareholderCtx = await loadShareholderContext(db, corporationForControl);
  const { isImperialCeo, isNppCeo, ceo, corpBorderMap } = shareholderCtx;

  const { ceoShareWindow, ceoIsInactive } = await loadCeoViewFlags(
    db,
    corporation,
    viewerUserId,
    isImperialCeo,
    currentTurn
  );

  const { refData, sectors, blendPresenceKeys, ftaCoverage } = await loadReferenceSectors(
    db,
    corporation,
    refDataPromise
  );
  const {
    commodityPrices,
    allStates,
    allTariffs,
    activeFtaPairs,
    activeSubsidies,
    exchangeRateDocs,
    stateBudgetsForTax,
  } = refData;

  const stateCtx = await loadStateViewContext(db, corporation, sectors, allStates);
  const { states, stateNameMap, stateCountryMap, uniqueStateIds, federalBudgets, gameState } =
    stateCtx;

  const fxByCurrency = new Map<CurrencyCode, number>(
    exchangeRateDocs.map((r) => [r.currencyCode as CurrencyCode, r.rate])
  );
  if (!fxByCurrency.has("USD")) fxByCurrency.set("USD", 1.0);

  // Every per-sector figure on this page is shown in the corp's home currency,
  // but sector economic fields are stored in each sector's HOST-state currency.
  // Restate host -> ₳ -> corp so the sector rows, totals, profit, and workers all
  // stay single-currency. Identity for domestic sectors (host == corp).
  const restatement = buildSectorCurrencyRestatement(corporation, fxByCurrency);
  const sectorFieldToCorpCcy = restatement.toCorpCurrency;

  const marketCtx = await loadMarketViewContext(db, {
    corporation,
    sectors,
    states,
    stateCountryMap,
    uniqueStateIds,
    fxByCurrency,
    gameState,
    commodityPrices,
  });

  // Realization-vs-nameplate reconciliation (#2958): derived from the corp's
  // own latest history snapshot; applied uniformly as the fallback for
  // sectors without an exact persisted realizedRevenue (#3001/#3002).
  // See realizationRatio.ts.
  const revenueRealizationRatio = await computeRevenueRealizationRatio(
    db,
    corporation,
    sectors,
    sectorFieldToCorpCcy
  );

  const { labourWagesEnabled, plantsMode, realizedGrowthRate } = await loadSectorModeFlags(
    db,
    corporation
  );

  const { sectorDetails, totals, wageBillAnchorPerTurnBySectorId, physicalRollups } =
    buildSectorDetails({
      corporation,
      sectors,
      currentTurn,
      plantsMode,
      labourWagesEnabled,
      revenueRealizationRatio,
      restatement,
      tariffs: { allTariffs, activeFtaPairs, activeSubsidies },
      tariffLookups: { blendPresenceKeys, ftaCoverage },
      stateCtx,
      marketCtx,
    });

  const portfolio = await loadPortfolioHoldings(db, corporation, currentTurn, fxByCurrency);

  const income = await computeIncomeStatement({
    db,
    corporation,
    currentTurn,
    totals,
    wageBillAnchorPerTurnBySectorId,
    labourWagesEnabled,
    restatement,
    fxByCurrency,
    federalBudgets,
    stateBudgetsForTax,
    sectorDetails,
    portfolio,
    bankingPolicyPromise,
    gameState,
  });

  const subsidiary = await loadSubsidiaryContext(
    db,
    corporationForControl,
    corporation,
    viewerUserId
  );

  const financials = buildFinancials({
    corporation,
    sectors,
    income,
    totals,
    portfolio,
    activeFloorPct: subsidiary.activeFloorPct,
    realizedGrowthRate,
  });

  const shareholders = buildShareholderList({
    corporationForControl,
    corporation,
    shareholderCtx,
    openListingsForInvariant,
    openSellOrdersForInvariant,
    totalShares: income.totalShares,
  });

  // Brand loyalty (Package A): the RAW 0–100 number and the corp's price-identity
  // norm are owner-only intel. Everyone else gets the hidden 5-label scale, never
  // the number. Absent ⇒ feature disabled for this corp; omit entirely so the UI
  // hides the indicator rather than showing a misleading 0.
  const brandLoyaltyFields = buildBrandLoyaltyFields(corporation, viewerUserId);

  // Corp-level physical P&L rollup (plants only). One object rather than eight
  // loose keys so a client can test `physical != null` as its plants switch and
  // cannot end up half-reading it.
  const physical = buildPhysicalPnl(plantsMode, physicalRollups, sectorDetails.length);

  const equityQuote = await equityQuotePromise;

  return {
    corporation: {
      ...brandLoyaltyFields,
      /** True when this world runs `marketSystemMode >= "plants"`. */
      plantsMode,
      labourEnabled: labourWagesEnabled,
      /** Corp-wide physical rollups; null outside plants. */
      physical,
      averageQuality:
        corporation.averageQuality != null
          ? Math.round(corporation.averageQuality * 10) / 10
          : undefined,
      ceoShareWindow,
      _id: corporation._id.toString(),
      sequentialId: corporation.sequentialId,
      name: corporation.name,
      tickerSymbol: corporation.tickerSymbol ?? undefined,
      description: corporation.description,
      type: corporation.type,
      countryId: corporation.countryId,
      secondaryType: corporation.secondaryType ?? null,
      typeSwitchCooldownUntilTurn: corporation.typeSwitchCooldownUntilTurn ?? null,
      typeSwitchTurn: corporation.typeSwitchTurn ?? null,
      currentTurn,
      typeLabel: CORPORATION_TYPE_LABELS[corporation.type],
      headquartersState: corporation.headquartersState,
      headquartersStateName:
        stateNameMap.get(corporation.headquartersState) ?? corporation.headquartersState,
      liquidCapital: Math.round(corporation.liquidCapital),
      liquidCurrencyCode:
        corporation.liquidCurrencyCode ??
        COUNTRY_CURRENCY_MAP[corporation.countryId as CountryId] ??
        "USD",
      recentNetIncome: Math.round(income.income),
      marketingBudget: corporation.marketingBudget,
      ceoSalary: income.ceoSalary,
      brandColor: corporation.brandColor,
      marketingStrength: roundMarketingStrength(corporation.marketingStrength),
      marketingStrengthGrowth: Math.round(income.marketingStrengthGrowth * 1000) / 1000,
      logisticsBudget: income.logisticsBudget,
      logisticsStrength: income.currentLogisticsStrength,
      logisticsStrengthNetChange: Math.round(income.logisticsStrengthNetChange * 1000) / 1000,
      rdBudget: corporation.rdBudget ?? 0,
      rdScore: Math.round(income.currentRdScore * 1000) / 1000,
      rdScoreNetChange: Math.round(income.rdScoreNetChange * 1000) / 1000,
      marketCapitalization: Math.round(income.marketCapitalization),
      logoUrl: corporation.logoUrl,
      headerImageUrl: corporation.headerImageUrl,
      sharePrice: income.currentSharePrice,
      equityMarketPoolActive: equityQuote.active,
      marketBidPrice: equityQuote.bidPriceLocal,
      marketAskPrice: equityQuote.askPriceLocal,
      marketDepthShares: equityQuote.bidDepthShares,
      totalShares: income.totalShares,
      publicFloat: corporation.publicFloat ?? 0,
      pendingIpoShares:
        corporation.pendingShareIssuance?.source === "ipo" &&
        corporation.pendingShareIssuance.issuedUpfront
          ? corporation.pendingShareIssuance.remainingShares
          : 0,
      shareholders,
      superShareMultiplier: corporation.superShareMultiplier ?? undefined,
      superSharesAdoptedAtTurn: corporation.superSharesAdoptedAtTurn ?? undefined,
      dividendRate: corporation.dividendRate ?? 0,
      lastDividendChange: corporation.lastDividendChange ?? null,
      lastShareIssuance: corporation.lastShareIssuance ?? null,
      shareBuybackMode: corporation.shareBuybackMode ?? "instant",
      shareEscrowBalance: corporation.shareEscrowBalance ?? 0,
      escrowFundingPerTurn: corporation.escrowFundingPerTurn ?? 0,
      lastEscrowWithdrawalTurn: corporation.lastEscrowWithdrawalTurn ?? undefined,
      lastShareholderAddressAt: corporation.lastShareholderAddressAt ?? null,
      legalStructure: corporation.legalStructure ?? undefined,
      legalStructureLabel: income.corpLegalStructure.shortName,
      legalStructureChangeCooldownUntilTurn:
        corporation.legalStructureChangeCooldownUntilTurn ?? null,
      lastShareStructureTurn: corporation.lastShareStructureTurn ?? null,
      // Era-scaled share-structure references. The reverse-split floor and the
      // "founding size" shortcut are both share COUNTS, so they deflate with
      // the era exactly like the mint sites do — otherwise a 1953 corp (whose
      // founding base is ~143k shares) sits permanently below a modern 1M
      // floor and can never reverse-split.
      shareConsolidationMinTotalShares: getEraFounderShares(
        SHARE_CONSOLIDATION_MIN_TOTAL_SHARES,
        resolvePresetIdFromGameState(gameState)
      ),
      foundingTotalShares: getEraFounderShares(
        CEO_INITIAL_SHARES,
        resolvePresetIdFromGameState(gameState)
      ),
      shareStructureCooldownTurnsRemaining:
        corporation.lastShareStructureTurn != null
          ? Math.max(
              0,
              corporation.lastShareStructureTurn + SHARE_STRUCTURE_COOLDOWN_TURNS - currentTurn
            )
          : 0,
      ceoVacant: corporation.ceoVacant ?? false,
      ceoCharacterId:
        corporation.ceoType === "character" && corporation.ceoId
          ? corporation.ceoId.toString()
          : null,
      // Underlying owner while a caretaker NPP runs the corp. Lets the front end
      // keep the CEO Office tab (and the "Resume Control" button) reachable for
      // the appointing owner even though the resolved `ceo` is now the NPP.
      caretakerUnderlyingCharacterId:
        corporation.caretakerCeo?.underlyingCharacterId?.toString() ?? null,
      caretakerMandate: corporation.caretakerCeo?.mandate ?? "active",
      // Turns left on the post-reclaim cooldown before a new caretaker may be installed.
      caretakerReappointCooldownTurnsRemaining: caretakerReappointCooldownRemaining(
        corporation,
        currentTurn
      ),
      pendingCeoCharacterId: corporation.pendingCeoCharacterId?.toString() ?? null,
      lastRenameTurn: corporation.lastRenameTurn ?? null,
      countryOwnerId: corporation.countryOwnerId ?? null,
      isNationalized: corporation.isNationalized ?? false,
      isPrivate: corporation.isPrivate ?? false,
      lastIpoTurn: corporation.lastIpoTurn ?? undefined,
      lastPrivatizationTurn: corporation.lastPrivatizationTurn ?? undefined,
      createdAt: corporation.createdAt,
      // Persisted, announced credit rating from the last turn's snapshot. Used as
      // the display LABEL so the page matches the credit-rating-change notification
      // (which is fired from this same persisted snapshot). The live /bonds recompute
      // double-smooths (feeds the already-smoothed composite back through the 0.75/0.25
      // blend), so it can diverge from the announced value — issuance pricing still
      // uses that live recompute, but the shown rating should be the announced one.
      creditRatingSnapshot: corporation.creditRatingSnapshot ?? undefined,
      creditCompositeSnapshot: corporation.creditCompositeSnapshot ?? undefined,
      // Suggestion #62: index-fund ownership and whether it has reached the
      // level that earns the credit notch and the price premium. Surfaced so
      // inclusion is a visible, chaseable goal rather than an invisible buff.
      indexOwnershipPercent: Math.round(indexFundOwnershipFraction(corporation) * 1000) / 10,
      indexInclusionActive:
        (corporation.isPrivate ?? false)
          ? false
          : qualifiesForIndexInclusionBenefit(indexFundOwnershipFraction(corporation)),
      parentCorporation: subsidiary.parentCorporationPayload,
      subsidiaries: subsidiary.subsidiariesPayload,
      hostileTakeoverEligibility: subsidiary.hostileTakeoverEligibility,
      isFormalizedSubsidiary: subsidiary.isFormalizedSub,
      canFormalizeAsSubsidiary: subsidiary.canFormalizeAsSubsidiary,
      canManageAsParent: subsidiary.canManageAsParent,
      canSpinOff: subsidiary.canSpinOff,
      parentDividendFloorPct: subsidiary.activeFloorPct > 0 ? subsidiary.activeFloorPct : undefined,
    },
    ceo:
      ceo && !corporation.ceoVacant
        ? {
            characterId: corporation.ceoId.toString(),
            name: ceo.name,
            avatarUrl: ceo.avatarUrl,
            sequentialId: ceo.sequentialId,
            isImperial: isImperialCeo,
            isNpp: isNppCeo,
            // Canonical profile route per CEO kind. NPP CEOs resolve to the
            // politician NPP profile (not /character/, which 404s for an NPP id).
            profilePath: isImperialCeo
              ? `/imperial/${ceo.sequentialId}`
              : isNppCeo
                ? `/politicians/npp/${ceo.sequentialId}`
                : `/character/${ceo.sequentialId}`,
            borderKey: ceo.userId
              ? (corpBorderMap.get(ceo.userId.toString())?.borderKey ?? null)
              : null,
            tintColor: ceo.userId
              ? (corpBorderMap.get(ceo.userId.toString())?.tintColor ?? null)
              : null,
          }
        : null,
    ceoIsInactive,
    financials,
    sectors: sectorDetails.map((sd) => {
      const tax = income.perSectorTax.get(sd._id.toString());
      return {
        ...sd,
        federalTaxPaid: tax?.federalTaxPaid ?? 0,
        stateTaxPaid: tax?.stateTaxPaid ?? 0,
        federalTaxRate: tax?.federalTaxRate ?? 0,
        stateTaxRate: tax?.stateTaxRate ?? 0,
      };
    }),
    balanceSheet: income.balanceSheet,
  };
}

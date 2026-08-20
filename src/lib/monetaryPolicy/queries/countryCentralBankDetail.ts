import { ObjectId, type Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  COUNTRY_CURRENCY_MAP,
  getCountryIdForCurrency,
  clampForexSpreadStrength,
  FOREX_SPREAD_STRENGTH_DEFAULT,
  FOREX_SPREAD_STRENGTH_MIN,
  FOREX_SPREAD_STRENGTH_MAX,
  FOREX_SPREAD_STRENGTH_COOLDOWN_TURNS,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import { getEraTrendGdpGrowth } from "@/lib/constants/monetaryEra";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getGameState } from "@/lib/gameState";
import { getDb } from "@/lib/mongodb";
import type {
  CentralBank,
  Character,
  CommodityPrice,
  Corporation,
  CorporateSector,
  ExchangeRate,
  GameConfig,
  MoneySupplySnapshot,
  NPP,
  Tariff,
} from "@/lib/db/types";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { LocLedgerEntry } from "@/lib/db/types/locLedger";
import type { PoliticalParty } from "@/lib/db/types/party";
import type { SavingsLedgerEntry } from "@/lib/db/types/savingsLedger";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import { getRateScale } from "@/lib/db/types";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  getHomeCurrency,
  getPersonalBalance,
  getTotalPersonalWealth,
} from "@/lib/currency/characterFunds";
import {
  calculateInflationWithBreakdown,
  computeEffectivePrimeRate,
  getInflationTarget,
} from "@/lib/budget/inflation";
import type { InflationBreakdown } from "@/lib/budget/inflation";
import { savingsFlowPressureRatio } from "@/lib/budget/savingsFlowPressure";
import { LOC_DEPOSIT_FRACTION } from "@/lib/lineOfCredit/locMath";
import {
  isNominationWindowOpen,
  CHAIR_ACCEPTANCE_WINDOW_TURNS,
} from "@/lib/turn/centralBankChairSelection";
import { computeCountryTariffPressure } from "@/lib/tariffs/tariffEffects";
import { buildFtaCoverageLookup, loadActiveFtaPairs } from "@/lib/tariffs/ftaOverrides";
import { buildCentralBankBootstrapUpdate, getCentralBankScope } from "@/lib/centralBank/helpers";
import { isBankGovernmentControlledLive } from "@/lib/centralBank/governance";
import { isNationalIssuer } from "@/lib/extraction/contractIssuerAuth";
import { buildFullReservePortfolioSummary } from "@/lib/centralBank/reservePortfolio";
import {
  RESERVE_POOL_TRANSFER_COOLDOWN_TURNS,
  computeReservePoolTransferLimits,
  turnsUntilReservePoolTransferReady,
} from "@/lib/centralBank/reservePoolTransfer";

type ViewerCharacter = Character | null;

export function alignInflationBreakdownToDisplayRate(params: {
  displayRate: number | null | undefined;
  computedRate: number;
  breakdown: InflationBreakdown;
}) {
  const displayRate =
    typeof params.displayRate === "number" && Number.isFinite(params.displayRate)
      ? params.displayRate
      : params.computedRate;
  const delta = displayRate - params.computedRate;

  return {
    currentInflation: displayRate,
    inflationBreakdownTotal: displayRate,
    inflationBreakdown: {
      ...params.breakdown,
      // Keep the displayed total and the breakdown explanation on the same canonical rate.
      inertia: params.breakdown.inertia + delta,
    },
  };
}

/**
 * Build the chair-data DTO for a central bank, surfacing whether the chair is
 * held by a player/NPP-politician (`"character"`) or by an autonomous technocrat
 * NPP (`"npp"`). When `chairMode === "npp"`, the technocrat NPP is looked up from
 * the `npps` collection by `bank.chairNppId` and its name flows through as the
 * chair's display name. Falls back to the legacy `chairCharacterId` lookup for
 * character chairs.
 */
export async function buildCentralBankChairData(
  db: Db,
  bank: CentralBank
): Promise<{
  chairData: {
    name: string;
    avatarUrl?: string;
    partyId?: string;
    partyName?: string;
    characterId: string;
    sequentialId?: number;
  } | null;
  chairMode: "character" | "npp";
  chairNppId: string | null;
}> {
  const chairMode: "character" | "npp" = bank.chairMode === "npp" ? "npp" : "character";
  const chairNppId = bank.chairNppId ? bank.chairNppId.toString() : null;

  if (chairMode === "npp") {
    // Autonomous technocrat chair: resolve the NPP by id. If the NPP doc is
    // missing (stale chairNppId), return the empty-chair state rather than
    // falling through to the character lookup — otherwise a leftover
    // chairCharacterId would render a player name under the "Autonomous Chair
    // (AI)" badge (M1). chairMode "npp" never resolves to a character.
    const npp = bank.chairNppId
      ? await db.collection<NPP>("npps").findOne({ _id: bank.chairNppId })
      : null;
    return {
      chairData: npp ? { characterId: npp._id.toHexString(), name: npp.name } : null,
      chairMode,
      chairNppId,
    };
  }

  let chairData: {
    name: string;
    avatarUrl?: string;
    partyId?: string;
    partyName?: string;
    characterId: string;
    sequentialId?: number;
  } | null = null;

  if (bank.chairCharacterId) {
    const character = await db
      .collection<Character>("characters")
      .findOne({ _id: new ObjectId(bank.chairCharacterId) });
    if (character) {
      const chairParty =
        character.party != null
          ? await db.collection<PoliticalParty>("politicalParties").findOne({
              sequentialId: Number(character.party),
              countryId: character.countryId,
            })
          : null;
      chairData = {
        characterId: character._id.toHexString(),
        sequentialId: character.sequentialId,
        name: character.name,
        avatarUrl: character.avatarUrl,
        partyId: character.party,
        partyName: chairParty?.name,
      };
    }
  }

  return { chairData, chairMode, chairNppId };
}

export async function loadCountryCentralBankDetail(params: {
  db?: Db;
  countryId: CountryId;
  viewer: {
    isAdmin: boolean;
    character: ViewerCharacter;
  } | null;
}) {
  const { countryId, viewer } = params;
  const db = params.db ?? (await getDb());
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) {
    return { ok: false as const, status: 404, error: "Country not found" };
  }

  const { bankId, memberCountries, intorgId } = await getCentralBankScope(db, countryId);
  const bank = await db
    .collection<CentralBank>("centralBanks")
    .findOneAndUpdate(
      { _id: bankId },
      buildCentralBankBootstrapUpdate(countryId, bankId, intorgId),
      { upsert: true, returnDocument: "after" }
    );

  if (!bank) {
    return { ok: false as const, status: 500, error: "Failed to load central bank" };
  }

  // Governance: who sets the rate here. The pre-1997 Bank of England is
  // government-controlled by default; legislation can override either way.
  // Keyed on the bank's HOME country: SCO/WAL reach the same BoE doc, and its
  // governance (and the government that holds the pen) is the UK's.
  const bankHomeCountryId = (bank.countryId ?? countryId) as CountryId;
  // Independent of one another once the bank doc is loaded — one round.
  const [
    governmentControlled,
    { chairData, chairMode, chairNppId },
    forexEnabled,
    budgetDoc,
    gameState,
  ] = await Promise.all([
    isBankGovernmentControlledLive(bank, bankHomeCountryId),
    buildCentralBankChairData(db, bank),
    isForexEnabled(),
    db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: getNationalBudgetId(countryId) } as { _id: "federal" }),
    getGameState(),
  ]);
  const viewerSetsRate =
    governmentControlled && viewer?.character
      ? await isNationalIssuer(db, bankHomeCountryId, viewer.character._id)
      : false;
  // Ticket #1072: the pending-appointment card told the nominee an offer was
  // waiting and gave them nowhere to accept it. The accept and decline routes
  // already existed; only the button was missing. Flag the nominee so the card
  // can show it to them and to nobody else.
  const viewerIsChairNominee =
    viewer?.character != null &&
    bank?.chairSelectionPending?.characterId != null &&
    String(bank.chairSelectionPending.characterId) === String(viewer.character._id);

  const isAdmin = viewer?.isAdmin === true;
  let isChair = false;
  let isExecutive = false;
  let userCashOnHand = 0;
  const nationalCurrency = COUNTRY_CURRENCY_MAP[countryId] as CurrencyCode;
  let rateMap: Partial<Record<CurrencyCode, number>> | undefined;
  let forexSpreadStrength = FOREX_SPREAD_STRENGTH_DEFAULT;
  let forexSpreadStrengthLastChangedTurn: number | null = null;
  if (forexEnabled) {
    const rateDocs = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();
    rateMap = Object.fromEntries(rateDocs.map((rate) => [rate.currencyCode, rate.rate])) as Partial<
      Record<CurrencyCode, number>
    >;
    // Spread strength lives on the currency's anchor exchangeRates doc.
    const anchorId = getCountryIdForCurrency(nationalCurrency);
    const myRateDoc = rateDocs.find((r) => r._id === anchorId);
    if (myRateDoc) {
      forexSpreadStrength = clampForexSpreadStrength(myRateDoc.forexSpreadStrength);
      forexSpreadStrengthLastChangedTurn = myRateDoc.forexSpreadStrengthLastChangedTurn ?? null;
    }
  }
  let userLobbyLiquid = 0;
  let userHomeCurrency: CurrencyCode = nationalCurrency;
  let userHomeLiquid = 0;

  if (viewer?.character) {
    const myChar = viewer.character;
    if (bank.chairCharacterId && myChar._id.equals(bank.chairCharacterId)) {
      isChair = true;
    }
    userCashOnHand = getTotalPersonalWealth(myChar, forexEnabled, rateMap);
    userHomeCurrency = getHomeCurrency(myChar);
    if (forexEnabled) {
      userLobbyLiquid = getPersonalBalance(myChar, nationalCurrency, true);
      userHomeLiquid = getPersonalBalance(myChar, userHomeCurrency, true);
    } else {
      userLobbyLiquid = myChar.cashOnHand ?? 0;
      userHomeLiquid = userLobbyLiquid;
    }

    const execOffice = COUNTRY_CONFIGS[myChar.countryId as CountryId]?.officeTypes.find(
      (office) => office.isExecutive
    );
    if (
      memberCountries.includes(myChar.countryId as CountryId) &&
      execOffice &&
      myChar.currentOffice?.type === execOffice.key
    ) {
      isExecutive = true;
    }
  }

  const rateScale = getRateScale(bank.primeRate);
  const recentHistory = bank.rateHistory.slice(-20).reverse();

  const currentInflation = budgetDoc?.economicFactors?.inflationRate ?? 2.5;
  const currentTurn = gameState?.currentTurn ?? 0;

  const nationalDocId = getNationalDocId(countryId);
  const [
    gameConfig,
    nationalMetrics,
    tariffs,
    commodityPriceDocs,
    savingsFlowAgg,
    fxDocForBreakdown,
    sectors,
    activeFtaPairs,
  ] = await Promise.all([
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { lineOfCreditEnabled: 1 } }),
    nationalDocId
      ? db.collection<StateMetrics>("macroMetrics").findOne({ _id: nationalDocId })
      : Promise.resolve(null),
    db.collection<Tariff>("tariffs").find({ countryId }).toArray(),
    db
      .collection<CommodityPrice>("commodityPrices")
      .find({}, { projection: { commodity: 1, basePrice: 1, nationalPrices: 1 } })
      .toArray(),
    db
      .collection<SavingsLedgerEntry>("savingsLedger")
      .aggregate<{ _id: { type: string }; total: number }>([
        {
          $match: {
            countryId,
            type: { $in: ["deposit", "withdraw"] },
            turn: { $gte: currentTurn - 12 },
          },
        },
        { $group: { _id: { type: "$type" }, total: { $sum: "$amount" } } },
      ])
      .toArray(),
    db.collection<ExchangeRate>("exchangeRates").findOne({ _id: countryId }),
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { countryId },
        { projection: { corporationId: 1, countryId: 1, sectorType: 1, revenue: 1 } }
      )
      .toArray(),
    loadActiveFtaPairs(db),
  ]);

  const breakdownUnemployment = nationalMetrics?.economic?.unemploymentRate?.value ?? 5.0;
  const breakdownGdpGrowth =
    nationalMetrics?.economic?.gdpGrowth?.value ??
    getEraTrendGdpGrowth(countryId, gameState?.currentYear) ??
    2.5;
  const corporationIds = [...new Set(sectors.map((sector) => sector.corporationId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const corporations =
    corporationIds.length > 0
      ? await db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: corporationIds } }, { projection: { countryId: 1 } })
          .toArray()
      : [];
  const corpById = new Map(
    corporations.map((corporation) => [corporation._id.toString(), corporation])
  );
  // FTA coverage neutralises the foreign-trade portion of every tariff layer
  // (broad scopes scale by `1 − partner-share`, narrow scopes flip binary), so
  // partnered trade no longer drives consumer-price inflation.
  const ftaCoverage = buildFtaCoverageLookup(sectors, corpById, activeFtaPairs);
  const breakdownTariffRate = computeCountryTariffPressure(
    tariffs,
    countryId,
    sectors,
    corpById,
    ftaCoverage
  );
  const commodityPressures: number[] = [];
  for (const doc of commodityPriceDocs) {
    const nationalPrice = (doc.nationalPrices as Record<string, number> | undefined)?.[countryId];
    if (nationalPrice != null && doc.basePrice > 0) {
      commodityPressures.push(nationalPrice / doc.basePrice - 1.0);
    }
  }
  const breakdownCommodityPressure =
    commodityPressures.length > 0
      ? commodityPressures.reduce((sum, value) => sum + value, 0) / commodityPressures.length
      : 0.0;
  const savingsDeposits = savingsFlowAgg.find((row) => row._id.type === "deposit")?.total ?? 0;
  const savingsWithdrawals = savingsFlowAgg.find((row) => row._id.type === "withdraw")?.total ?? 0;
  const totalSavingsBalance = bank.nationalSavingsBalance ?? 0;
  const breakdownSavingsPressure = savingsFlowPressureRatio(
    savingsWithdrawals - savingsDeposits,
    savingsDeposits + savingsWithdrawals,
    totalSavingsBalance
  );
  const breakdownForexPressure =
    fxDocForBreakdown != null && fxDocForBreakdown.baseRate > 0
      ? fxDocForBreakdown.rate / fxDocForBreakdown.baseRate - 1.0
      : 0.0;

  const primeRateHistory = bank.interestRateHistory?.map((snapshot) => snapshot.rate) ?? [];
  const effectiveRate = computeEffectivePrimeRate(bank.primeRate, primeRateHistory);
  const gdp = budgetDoc?.gdp || 27_000_000_000_000;
  const surplusToGdp = (budgetDoc?.surplus ?? 0) / gdp;
  const moneyForBreakdown = await db
    .collection<MoneySupplySnapshot>("moneySupplySnapshots")
    .findOne({ currencyCode: nationalCurrency }, { sort: { turn: -1 } });

  const { rate: computedInflationRate, breakdown: computedInflationBreakdown } =
    calculateInflationWithBreakdown({
      unemployment: breakdownUnemployment,
      gdpGrowth: breakdownGdpGrowth,
      primeRate: bank.primeRate,
      primeRateHistory,
      surplusToGdp,
      tariffRate: breakdownTariffRate,
      wageGrowth: budgetDoc?.economicFactors?.wageGrowth ?? 3.0,
      commodityPressure: breakdownCommodityPressure,
      forexPressure: breakdownForexPressure,
      savingsPressure: breakdownSavingsPressure,
      previousInflation: budgetDoc?.economicFactors?.inflationRate ?? 2.5,
      policyStancePressure: bank.policyInflationPressure ?? 0,
      moneySupplyGrowthPct: moneyForBreakdown?.annualizedM2GrowthPct ?? breakdownGdpGrowth,
    });
  const {
    currentInflation: displayInflation,
    inflationBreakdownTotal,
    inflationBreakdown,
  } = alignInflationBreakdownToDisplayRate({
    displayRate: currentInflation,
    computedRate: computedInflationRate,
    breakdown: computedInflationBreakdown,
  });

  const nominationWindowOpen = isNominationWindowOpen(bank, currentTurn);
  const chairSelectionPending = bank.chairSelectionPending
    ? {
        characterId: bank.chairSelectionPending.characterId.toString(),
        characterName: bank.chairSelectionPending.characterName,
        pool: bank.chairSelectionPending.pool,
        proposedAt: bank.chairSelectionPending.proposedAt.toISOString(),
        proposedAtTurn: bank.chairSelectionPending.proposedAtTurn ?? null,
        // Turns the nominee has left to accept before the pick auto-lapses and
        // re-selects. Null when proposedAtTurn is absent (legacy pending docs).
        acceptanceTurnsRemaining:
          typeof bank.chairSelectionPending.proposedAtTurn === "number"
            ? Math.max(
                0,
                CHAIR_ACCEPTANCE_WINDOW_TURNS -
                  (currentTurn - bank.chairSelectionPending.proposedAtTurn)
              )
            : null,
      }
    : null;

  const pendingChairRequiresMyResponse =
    bank.chairSelectionPending != null &&
    viewer?.character != null &&
    viewer.character._id.equals(bank.chairSelectionPending.characterId);

  const nominations = (bank.nominations ?? []).map((nomination) => ({
    characterId: nomination.characterId.toString(),
    characterName: nomination.characterName,
    nominatedByName: nomination.nominatedByName,
    nominatedAt: nomination.nominatedAt,
  }));

  const lobbyTotalsMap = new Map<
    string,
    { characterId: string; characterName: string; totalAmount: number }
  >();
  for (const entry of bank.lobbyingPool ?? []) {
    const key = entry.targetCharacterId.toString();
    const existing = lobbyTotalsMap.get(key);
    if (existing) {
      existing.totalAmount += entry.amount;
    } else {
      lobbyTotalsMap.set(key, {
        characterId: key,
        characterName: entry.targetCharacterName,
        totalAmount: entry.amount,
      });
    }
  }

  const lobbyCharIds = [...lobbyTotalsMap.keys()].map((id) => new ObjectId(id));
  const lobbyChars =
    lobbyCharIds.length > 0
      ? await db
          .collection<Character>("characters")
          .find({ _id: { $in: lobbyCharIds } })
          .project<Pick<Character, "_id" | "avatarUrl" | "sequentialId">>({
            _id: 1,
            avatarUrl: 1,
            sequentialId: 1,
          })
          .toArray()
      : [];
  const lobbyAvatarMap = new Map(
    lobbyChars.map((character) => [character._id.toString(), character.avatarUrl ?? null])
  );
  const lobbySeqIdMap = new Map(
    lobbyChars.map((character) => [character._id.toString(), character.sequentialId])
  );
  const lobbyingTotals = Array.from(lobbyTotalsMap.values())
    .map((entry) => ({
      ...entry,
      avatarUrl: lobbyAvatarMap.get(entry.characterId) ?? null,
      sequentialId: lobbySeqIdMap.get(entry.characterId),
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  const homeCurrency = nationalCurrency;
  const [locAgg, savingsInterestAgg, locInterestAccrualAgg, locPaymentInterestAgg] =
    await Promise.all([
      db
        .collection<Character>("characters")
        .aggregate<{ totalBalance: number; totalArrears: number }>([
          {
            $match: {
              $or: [
                { [`lineOfCredit.balances.${homeCurrency}`]: { $gt: 0 } },
                { [`lineOfCredit.arrears.${homeCurrency}`]: { $gt: 0 } },
              ],
            },
          },
          {
            $group: {
              _id: null,
              totalBalance: {
                $sum: { $ifNull: [`$lineOfCredit.balances.${homeCurrency}`, 0] },
              },
              totalArrears: {
                $sum: { $ifNull: [`$lineOfCredit.arrears.${homeCurrency}`, 0] },
              },
            },
          },
        ])
        .toArray(),
      db
        .collection<SavingsLedgerEntry>("savingsLedger")
        .aggregate<{ total: number }>([
          { $match: { countryId, type: "interest", currencyCode: homeCurrency } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ])
        .toArray(),
      db
        .collection<LocLedgerEntry>("locLedger")
        .aggregate<{ total: number }>([
          { $match: { countryId, type: "interest", currencyCode: homeCurrency } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ])
        .toArray(),
      db
        .collection<LocLedgerEntry>("locLedger")
        .aggregate<{ total: number }>([
          {
            $match: {
              countryId,
              currencyCode: homeCurrency,
              type: { $in: ["auto_payment", "repay"] },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: { $ifNull: ["$interestPortion", 0] } },
            },
          },
        ])
        .toArray(),
    ]);

  const locRow = locAgg[0];
  const totalDeposits = bank.nationalSavingsBalance ?? 0;
  const bankReserves = bank.reserveBalance ?? 0;
  const reservePortfolio = buildFullReservePortfolioSummary({
    homeCurrency,
    reserveBalance: bankReserves,
    spreadFeeReserveBalances: bank.spreadFeeReserveBalances,
    rates: rateMap,
  });
  const totalLoansOutstanding = (locRow?.totalBalance ?? 0) + (locRow?.totalArrears ?? 0);
  const systemCap = (totalDeposits + bankReserves) * LOC_DEPOSIT_FRACTION;
  const availableCapacity = Math.max(0, systemCap - totalLoansOutstanding);
  const forexRevenue = bank.forexRevenue ?? 0;
  const reservePoolTransferLimits = computeReservePoolTransferLimits({
    forexRevenue,
    lendingReserves: bankReserves,
    totalDeposits,
    totalLoansOutstanding,
  });
  const reservePoolTransferCooldownRemaining = turnsUntilReservePoolTransferReady({
    currentTurn,
    lastTransferTurn: bank.lastReservePoolTransferTurn,
    isAdmin,
  });
  const reservePoolTransferNextTurn =
    bank.lastReservePoolTransferTurn != null
      ? bank.lastReservePoolTransferTurn + RESERVE_POOL_TRANSFER_COOLDOWN_TURNS
      : null;
  const savingsInterestExpenseLifetime = savingsInterestAgg[0]?.total ?? 0;
  const locInterestAccruedLifetime = locInterestAccrualAgg[0]?.total ?? 0;
  const locInterestReceivedLifetime = locPaymentInterestAgg[0]?.total ?? 0;
  const [moneySupply, eligibleQeBonds] = await Promise.all([
    Promise.resolve(moneyForBreakdown),
    db
      .collection("bonds")
      .find(
        {
          issuerType: "sovereign",
          countryId,
          matured: false,
          defaulted: false,
        },
        {
          projection: {
            _id: 1,
            issuerName: 1,
            couponRate: 1,
            maturityTurn: 1,
            marketPrice: 1,
            publicFloat: 1,
            centralBankHoldings: 1,
            qeSupportRatio: 1,
          },
        }
      )
      .toArray(),
  ]);

  return {
    ok: true as const,
    body: {
      countryId,
      bankName: config.centralBank.name,
      abbreviation: config.centralBank.abbreviation,
      chairTitle: config.centralBank.chairTitle,
      currencyCode: nationalCurrency,
      primeRate: bank.primeRate,
      lastRateChangeTurn: bank.lastRateChangeTurn ?? null,
      chairControlsLocked: bank.chairControlsLocked === true,
      // A seated committee owns the rate: the chair's direct control is gone and
      // the card must send players to the committee room instead of a dead POST.
      committeeSeated: (bank.fomcBoard?.length ?? 0) > 0,
      currentSavingsPressure: bank.currentSavingsPressure ?? 0,
      currentInflation: displayInflation,
      targetInflation: getInflationTarget(countryId, gameState?.currentYear),
      inflationBreakdownTotal,
      inflationBreakdown,
      effectiveRate,
      rateScale,
      chair: chairData,
      chairMode,
      chairNppId,
      chairAppointedAt: bank.chairAppointedAt,
      chairInfamy: bank.chairInfamy ?? 0,
      resolveStreak: bank.resolveStreak ?? 0,
      chairTermExpiresAtTurn: bank.chairTermExpiresAtTurn ?? null,
      currentTurn,
      nominationWindowOpen,
      chairSelectionPending,
      pendingChairRequiresMyResponse,
      nominations,
      lobbyingTotals,
      rateHistory: recentHistory,
      interestRateHistory: bank.interestRateHistory ?? [],
      inflationHistory: bank.inflationHistory ?? [],
      gdpGrowthHistory: bank.gdpGrowthHistory ?? [],
      savingsFlowHistory: bank.savingsFlowHistory ?? [],
      isChair,
      isAdmin,
      isExecutive,
      governmentControlled,
      viewerSetsRate,
      viewerIsChairNominee,
      userCashOnHand,
      nationalCurrency,
      userLobbyLiquid,
      userHomeCurrency,
      userHomeLiquid,
      lineOfCreditEnabled: gameConfig?.lineOfCreditEnabled === true,
      balanceSheet: {
        homeCurrency,
        totalDeposits,
        bankReserves,
        reservePortfolio,
        forexRevenue,
        totalLoansOutstanding,
        systemCap,
        availableCapacity,
        reservePoolTransferMaxToLending: reservePoolTransferLimits.maxToLending,
        reservePoolTransferMaxToForex: reservePoolTransferLimits.maxToForex,
        reservePoolTransferCooldownRemaining,
        reservePoolTransferNextTurn,
      },
      bankFinancials: {
        homeCurrency,
        savingsInterestExpenseLifetime,
        locInterestAccruedLifetime,
        locInterestReceivedLifetime,
        netInterestIncomeLifetime: locInterestAccruedLifetime - savingsInterestExpenseLifetime,
      },
      moneySupply:
        gameConfig?.moneySupplyEnabled === true && moneySupply
          ? {
              ...moneySupply,
              operations: bank.monetaryOperations ?? [],
              lastOperationTurn: bank.lastMonetaryOperationTurn ?? null,
              lastPolicyEvaluation: bank.lastMonetaryPolicyEvaluation ?? null,
              eligibleBonds: eligibleQeBonds.map((bond) => ({
                ...bond,
                _id: bond._id.toString(),
              })),
            }
          : null,
      intervention: {
        currencyCode: nationalCurrency,
        baseRate: fxDocForBreakdown?.baseRate ?? null,
        currentRate: fxDocForBreakdown?.rate ?? null,
        policy: fxDocForBreakdown?.interventionPolicy
          ? {
              floor: fxDocForBreakdown.interventionPolicy.floor,
              ceiling: fxDocForBreakdown.interventionPolicy.ceiling,
              setByCharacterName: fxDocForBreakdown.interventionPolicy.setByCharacterName,
              setAtTurn: fxDocForBreakdown.interventionPolicy.setAtTurn,
              lastAdjustedAtTurn: fxDocForBreakdown.interventionPolicy.lastAdjustedAtTurn,
              recentInterventions:
                isChair || isAdmin ? fxDocForBreakdown.interventionPolicy.recentInterventions : [],
            }
          : null,
        forexRevenue: isChair || isAdmin ? (bank.forexRevenue ?? 0) : null,
        reserveBalance: isChair || isAdmin ? (bank.reserveBalance ?? 0) : null,
        // Chair-controlled spread-strength lever (public so all players see the
        // current setting; cooldown info lets the chair UI gate the slider).
        forexSpread: {
          strength: forexSpreadStrength,
          min: FOREX_SPREAD_STRENGTH_MIN,
          max: FOREX_SPREAD_STRENGTH_MAX,
          default: FOREX_SPREAD_STRENGTH_DEFAULT,
          cooldownTurns: FOREX_SPREAD_STRENGTH_COOLDOWN_TURNS,
          lastChangedTurn: forexSpreadStrengthLastChangedTurn,
          nextChangeTurn:
            forexSpreadStrengthLastChangedTurn != null
              ? forexSpreadStrengthLastChangedTurn + FOREX_SPREAD_STRENGTH_COOLDOWN_TURNS
              : currentTurn,
          turnsRemaining:
            forexSpreadStrengthLastChangedTurn != null
              ? Math.max(
                  0,
                  forexSpreadStrengthLastChangedTurn +
                    FOREX_SPREAD_STRENGTH_COOLDOWN_TURNS -
                    currentTurn
                )
              : 0,
          canEdit: isChair || isAdmin,
        },
      },
    },
  };
}

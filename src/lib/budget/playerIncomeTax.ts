/**
 * Player income tax. Salary, dividends, coupons and savings interest are assessed
 * together after income phases. Frozen settlement receipts prevent duplicate tax
 * and retain unpaid assessments when a balance cannot cover the guarded debit.
 */
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import type { TradeHistoryEntry } from "@/lib/db/types/tradeHistory";
import { type Db, type AnyBulkWriteOperation } from "mongodb";
import type {
  Character,
  FederalBudget,
  StateBudget,
  ExchangeRate,
  GameState,
} from "@/lib/db/types";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { PlayerIncomeTaxAssessment, PlayerIncomeTaxTurnPlan } from "@/lib/db/types/incomeTax";
import { settlePlayerIncomeTaxAssessments } from "./playerIncomeTaxSettlement";
import {
  capitalGainsTaxRate,
  taxableStockAmounts,
  validatePendingStockTaxReceipt,
} from "./rules/capitalGainsTax";
import {
  TAXABLE_PLAYER_INCOME_TYPES,
  earnedIncomeTier,
  incomeTaxRate,
  playerIncomeTax,
  annualizedIncome,
} from "./rules/incomeTaxTiers";

export const PLAYER_TAX_KIND = "player_income_tax";
const LOOKBACK_TURNS = 12;
type TaxIncomeEntry = Pick<
  FinancialTxLogEntry,
  "subjectId" | "type" | "turn" | "amount" | "anchorAmount" | "currencyCode" | "meta"
>;

/** All input collections are loaded once; settlements retain per-taxpayer cash guards. */
export async function processPlayerIncomeTax(
  db: Db,
  turn: number,
  now: Date,
  gameState: Pick<
    GameState,
    "forexEnabled" | "resetWorldId" | "preset" | "stockHoldingTaxStartTurn"
  >,
  fundedTreasury: boolean,
  ledgerShadow = false,
  turnLengthMinutes = 60
): Promise<{ assessed: number; pending: number }> {
  const [
    entries,
    regularCharacters,
    budgets,
    regional,
    metrics,
    exchange,
    conversions,
    imperialCharacters,
  ] = await Promise.all([
    db
      .collection<FinancialTxLogEntry>("financialTxLog")
      .find(
        {
          subjectType: "character",
          type: { $in: [...TAXABLE_PLAYER_INCOME_TYPES] },
          turn: { $gte: Math.max(0, turn - LOOKBACK_TURNS + 1), $lte: turn },
          amount: { $gt: 0 },
        },
        {
          projection: {
            subjectId: 1,
            type: 1,
            turn: 1,
            amount: 1,
            anchorAmount: 1,
            currencyCode: 1,
            meta: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<Character>("characters")
      .find(
        { incomeTaxStartTurn: { $lte: turn } },
        {
          projection: {
            name: 1,
            homeState: 1,
            countryId: 1,
            incomeTaxStartTurn: 1,
            incomeTier: 1,
            pendingStockTaxReceipts: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<FederalBudget>("federalBudget")
      .find({}, { projection: { countryId: 1, taxRates: 1, currencyCode: 1 } })
      .toArray(),
    db
      .collection<StateBudget>("stateBudgets")
      .find({}, { projection: { countryId: 1, taxRates: 1 } })
      .toArray(),
    db
      .collection<MacroMetricsDoc>("macroMetrics")
      .find({}, { projection: { "economic.medianIncome.value": 1 } })
      .toArray(),
    db
      .collection<ExchangeRate>("exchangeRates")
      .find({}, { projection: { currencyCode: 1, rate: 1 } })
      .toArray(),
    db
      .collection<TradeHistoryEntry>("tradeHistory")
      .find(
        { turn, source: { $in: ["auto_dividend", "auto_coupon"] } },
        {
          projection: {
            buyerCharacterId: 1,
            fromCurrency: 1,
            toCurrency: 1,
            amount: 1,
            receivedAmount: 1,
            rate: 1,
            spread: 1,
            source: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<ImperialCharacter>("imperialCharacters")
      .find(
        { incomeTaxStartTurn: { $lte: turn } },
        {
          projection: {
            name: 1,
            homeState: 1,
            countryId: 1,
            incomeTaxStartTurn: 1,
            incomeTier: 1,
            pendingStockTaxReceipts: 1,
          },
        }
      )
      .toArray(),
  ]);
  const characters = [...regularCharacters, ...imperialCharacters];
  const regularIds = new Set(regularCharacters.map((character) => character._id.toHexString()));
  const fx = new Map(exchange.map((rate) => [rate.currencyCode as string, rate.rate]));
  const budgetByCountry = new Map(budgets.map((budget) => [budget.countryId, budget]));
  const stateBudgets = new Map(regional.map((budget) => [budget._id, budget]));
  const medianByState = new Map(
    metrics.map((metric) => [metric._id, metric.economic?.medianIncome?.value])
  );
  const byCharacter = new Map<string, TaxIncomeEntry[]>();
  for (const entry of entries) {
    if (!entry.subjectId || !Number.isFinite(entry.amount)) continue;
    const id = entry.subjectId.toHexString();
    const rows = byCharacter.get(id) ?? [];
    rows.push(entry);
    byCharacter.set(id, rows);
  }
  // Sale receipts share the atomic wallet credit. Display/audit-log failures
  // cannot hide a realized gain, and a compensated sale removes its receipt.
  // Retain assessed sales for the earnings lookback; exact due-turn filtering
  // and immutable plans prevent a retained receipt from being taxed twice.
  for (const character of characters) {
    const rows = byCharacter.get(character._id.toHexString()) ?? [];
    const seen = new Set<string>();
    for (const receipt of character.pendingStockTaxReceipts ?? []) {
      validatePendingStockTaxReceipt(receipt);
      if (seen.has(receipt.id)) throw new Error("Duplicate stock tax credit identity");
      seen.add(receipt.id);
      rows.push({
        subjectId: character._id,
        type: "stock_trade_sell",
        turn: receipt.saleTurn,
        amount: receipt.amount,
        anchorAmount: receipt.anchorAmount,
        currencyCode: receipt.currencyCode as FinancialTxLogEntry["currencyCode"],
        meta: { stockTax: receipt },
      });
    }
    byCharacter.set(character._id.toHexString(), rows);
  }
  const conversionByKey = new Map<string, { spent: number; received: number }>();
  for (const conversion of conversions) {
    const key =
      conversion.buyerCharacterId.toHexString() +
      ":" +
      conversion.source +
      ":" +
      conversion.fromCurrency +
      ":" +
      conversion.toCurrency;
    const total = conversionByKey.get(key) ?? { spent: 0, received: 0 };
    total.spent += conversion.amount;
    total.received +=
      conversion.receivedAmount ??
      Math.round((conversion.amount - conversion.spread) * conversion.rate);
    conversionByKey.set(key, total);
  }
  const worldId = gameState.resetWorldId ?? "legacy";
  const existingPlans = await db
    .collection<PlayerIncomeTaxTurnPlan>("playerIncomeTaxAssessments")
    .find({ status: "plan", worldId, turn })
    .toArray();
  // A request can pass the turn guard just before the turn starts, then
  // commit its wallet credit after that turn's plan freezes. Recover delayed
  // credits by identity rather than silently exempting their old due turn.
  const receiptDueTurns = characters.flatMap((actor) =>
    (actor.pendingStockTaxReceipts ?? []).map((receipt) => receipt.assessmentTurn)
  );
  const earliestDue = receiptDueTurns.reduce((earliest, due) => Math.min(earliest, due), turn);
  const previousPlans =
    receiptDueTurns.length && earliestDue < turn
      ? await db
          .collection<PlayerIncomeTaxTurnPlan>("playerIncomeTaxAssessments")
          .find(
            { status: "plan", worldId, turn: { $gte: earliestDue, $lt: turn } },
            { projection: { characterId: 1, ownerCollection: 1, stockTaxReceiptIds: 1 } }
          )
          .batchSize(1000)
          .toArray()
      : [];
  const assessedStockIds = new Set(
    previousPlans.flatMap((plan) =>
      (plan.stockTaxReceiptIds ?? []).map(
        (id) => plan.ownerCollection + ":" + plan.characterId.toHexString() + ":" + id
      )
    )
  );
  const plannedActors = new Set(
    existingPlans.map((plan) => plan.ownerCollection + ":" + plan.characterId.toHexString())
  );
  const planOps: AnyBulkWriteOperation<PlayerIncomeTaxTurnPlan>[] = [];
  const assessmentOps: AnyBulkWriteOperation<PlayerIncomeTaxAssessment>[] = [];
  const tierOps: AnyBulkWriteOperation<Character>[] = [];
  const imperialTierOps: AnyBulkWriteOperation<ImperialCharacter>[] = [];
  for (const character of characters) {
    const ownerCollection: "characters" | "imperialCharacters" = regularIds.has(
      character._id.toHexString()
    )
      ? "characters"
      : "imperialCharacters";
    if (plannedActors.has(ownerCollection + ":" + character._id.toHexString())) continue;
    const actorAssessments: PlayerIncomeTaxAssessment[] = [];
    const country = character.countryId;
    const budget = budgetByCountry.get(country);
    const stateBudget = stateBudgets.get(character.homeState);
    const amounts = (entry: TaxIncomeEntry) =>
      gameState.stockHoldingTaxStartTurn !== undefined &&
      turn >= gameState.stockHoldingTaxStartTurn &&
      (entry.type === "stock_trade_sell" || entry.type === "corp_dividend")
        ? taxableStockAmounts(entry.type, entry.amount, entry.meta?.stockTax)
        : {
            income: entry.type === "stock_trade_sell" ? 0 : entry.amount,
            capital: 0,
            assessmentTurn: undefined,
          };
    const eligibleRows = (byCharacter.get(character._id.toHexString()) ?? []).filter((entry) => {
      const due = amounts(entry).assessmentTurn ?? entry.turn;
      return due >= character.incomeTaxStartTurn! && due <= turn;
    });
    const rows = eligibleRows.filter(
      (entry) => (amounts(entry).assessmentTurn ?? entry.turn) >= turn - LOOKBACK_TURNS + 1
    );
    const current = eligibleRows.filter((entry) => {
      if (entry.type === "stock_trade_sell") {
        const receipt = entry.meta?.stockTax as { id?: string } | undefined;
        return (
          !!receipt?.id &&
          !assessedStockIds.has(
            ownerCollection + ":" + character._id.toHexString() + ":" + receipt.id
          )
        );
      }
      const taxable = amounts(entry);
      return (
        (taxable.assessmentTurn ?? entry.turn) === turn &&
        (taxable.income > 0 || taxable.capital > 0)
      );
    });
    if (!current.length) continue;
    if (!budget?.taxRates) throw new Error("Income-tax budget unavailable for " + country);
    const home = getHomeCurrency(character, gameState.preset);
    const homeFx = fx.get(home);
    const median = medianByState.get(character.homeState);
    if (!homeFx || !(homeFx > 0) || !Number.isFinite(homeFx) || !median || !(median > 0))
      throw new Error("Income-tax earnings reference unavailable");
    const anchor = (entry: TaxIncomeEntry) => {
      const rate = fx.get(entry.currencyCode);
      if (!rate || !(rate > 0) || !Number.isFinite(rate))
        throw new Error("Income-tax currency unavailable");
      const income = amounts(entry).income;
      const value =
        entry.amount > 0
          ? ((entry.anchorAmount ?? entry.amount / rate) * income) / entry.amount
          : 0;
      if (!Number.isFinite(value) || value < 0) throw new Error("Invalid taxable player receipt");
      return value;
    };
    const annual = annualizedIncome(
      rows.reduce((sum, entry) => sum + anchor(entry), 0) * homeFx,
      Math.min(LOOKBACK_TURNS, turn - character.incomeTaxStartTurn! + 1),
      TURNS_PER_YEAR
    );
    const tier = earnedIncomeTier(annual, median);
    const groups = new Map<
      string,
      { currency: string; path: string; gross: number; taxKind: "income" | "capitalGains" }
    >();
    for (const entry of current) {
      const conversionSource =
        entry.type === "corp_dividend"
          ? "auto_dividend"
          : entry.type === "bond_coupon"
            ? "auto_coupon"
            : null;
      const conversion = conversionSource
        ? conversionByKey.get(
            character._id.toHexString() +
              ":" +
              conversionSource +
              ":" +
              entry.currencyCode +
              ":" +
              home
          )
        : undefined;
      const converted =
        gameState.forexEnabled === true &&
        conversion &&
        conversion.spent > 0 &&
        Number.isFinite(conversion.spent) &&
        Number.isFinite(conversion.received);
      const currency = converted ? home : entry.currencyCode;
      const path =
        gameState.forexEnabled === true ? "currencyBalances.personal." + currency : "cashOnHand";
      const taxable = amounts(entry);
      for (const taxKind of ["income", "capitalGains"] as const) {
        const amount = taxKind === "income" ? taxable.income : taxable.capital;
        if (!(amount > 0)) continue;
        const gross = converted
          ? (amount / conversion.spent) * conversion.received
          : entry.type === "stock_trade_sell" && gameState.forexEnabled !== true
            ? amount * (entry.anchorAmount! / entry.amount) * fx.get(currency)!
            : amount;
        // Preserve historical income assessment IDs for replay compatibility.
        const key = path + ":" + currency + (taxKind === "capitalGains" ? ":capitalGains" : "");
        const group = groups.get(key) ?? { currency, path, gross: 0, taxKind };
        group.gross += gross;
        groups.set(key, group);
      }
    }
    for (const [groupId, group] of groups) {
      const key =
        "player-income-tax:" +
        (gameState.resetWorldId ?? "legacy") +
        ":" +
        turn +
        ":" +
        character._id.toHexString() +
        ":" +
        groupId;
      const rate = fx.get(group.currency)!;
      const rateFor = group.taxKind === "capitalGains" ? capitalGainsTaxRate : incomeTaxRate;
      const tax = playerIncomeTax(
        group.gross,
        rateFor(budget.taxRates, tier),
        stateBudget?.taxRates && stateBudget.countryId === country
          ? rateFor(stateBudget.taxRates, tier)
          : 0
      );
      const total = tax.federal + tax.regional;
      const federalCurrency = budget.currencyCode ?? home;
      const federalFx = fx.get(federalCurrency);
      if (!federalFx || !(federalFx > 0) || !Number.isFinite(federalFx))
        throw new Error("Income-tax treasury currency unavailable");
      const assessment: PlayerIncomeTaxAssessment = {
        ...(group.taxKind === "capitalGains" ? { taxKind: group.taxKind } : {}),
        _id: key,
        characterId: character._id,
        ownerCollection,
        turn,
        worldId: gameState.resetWorldId ?? "legacy",
        name: character.name,
        tier,
        currency: group.currency,
        sourcePath: group.path,
        sourceFx: rate,
        walletFx: gameState.forexEnabled === true ? rate : 1,
        countryId: country,
        nationalBudgetId: getNationalBudgetId(country),
        nationalCurrency: federalCurrency,
        nationalFx: federalFx,
        stateId: character.homeState,
        regionalCurrency: home,
        regionalFx: homeFx,
        ...tax,
        status: total > 0 ? "unpaid" : "paid",
        createdAt: now,
      };
      actorAssessments.push(assessment);
    }
    const plan: PlayerIncomeTaxTurnPlan = {
      _id:
        "plan:" + worldId + ":" + turn + ":" + ownerCollection + ":" + character._id.toHexString(),
      status: "plan",
      worldId,
      turn,
      characterId: character._id,
      ownerCollection,
      tier,
      assessments: actorAssessments,
      stockTaxReceiptIds: current
        .filter((entry) => entry.type === "stock_trade_sell")
        .map((entry) => (entry.meta!.stockTax as { id: string }).id),
    };
    planOps.push({
      updateOne: { filter: { _id: plan._id }, update: { $setOnInsert: plan }, upsert: true },
    });
  }
  if (planOps.length)
    await db.collection<PlayerIncomeTaxTurnPlan>("playerIncomeTaxAssessments").bulkWrite(planOps);
  const ownedPlans = await db
    .collection<PlayerIncomeTaxTurnPlan>("playerIncomeTaxAssessments")
    .find({ status: "plan", worldId, turn })
    .toArray();
  for (const plan of ownedPlans) {
    for (const assessment of plan.assessments)
      assessmentOps.push({
        updateOne: {
          filter: { _id: assessment._id },
          update: { $setOnInsert: assessment },
          upsert: true,
        },
      });
    (plan.ownerCollection === "characters" ? tierOps : imperialTierOps).push({
      updateOne: {
        filter: { _id: plan.characterId },
        update: {
          $set: { incomeTier: plan.tier },
          $pull: {
            pendingStockTaxReceipts: { assessmentTurn: { $lt: turn - LOOKBACK_TURNS + 1 } },
          },
        },
      },
    });
  }
  if (tierOps.length) await db.collection<Character>("characters").bulkWrite(tierOps);
  if (imperialTierOps.length)
    await db.collection<ImperialCharacter>("imperialCharacters").bulkWrite(imperialTierOps);
  const inserted = assessmentOps.length
    ? await db
        .collection<PlayerIncomeTaxAssessment>("playerIncomeTaxAssessments")
        .bulkWrite(assessmentOps)
    : undefined;
  await settlePlayerIncomeTaxAssessments(
    db,
    turn,
    now,
    gameState.resetWorldId ?? "legacy",
    fundedTreasury,
    ledgerShadow,
    turnLengthMinutes
  );
  const pending = await db
    .collection<PlayerIncomeTaxAssessment>("playerIncomeTaxAssessments")
    .countDocuments({ worldId: gameState.resetWorldId ?? "legacy", status: "unpaid" });
  return { assessed: inserted?.upsertedCount ?? 0, pending };
}

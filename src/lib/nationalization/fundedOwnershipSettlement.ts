/**
 * Funded nationalization settlement. Frozen Treasury quotes pay shareholders
 * and liquidate acquired corporation cash through replay-safe cash legs.
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character, Corporation, IndexFund } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import {
  anchorToCorpLiquidCapital,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { buildPersonalBalanceInc, getHomeCurrency } from "@/lib/currency/characterFunds";
import { allocateShareholderPool } from "@/lib/bonds/corporateBondDefault";
import { treasuryAnchorValuation } from "@/lib/budget/rules/treasuryAccrual";
import { writeGovBudgetLocal } from "@/lib/currency/govBudgetFields";
import { resumeSettlement, settleTransition } from "@/lib/banking/settlementJournal";
import type { BankingTransition, TransitionLeg } from "@/lib/banking/rules/boundary";
import type { TreasuryCashOptions } from "./treasuryLedger";

/**
 * Distribute a ₳-denominated shareholder pool pro-rata across every bucket:
 * character + imperial holders (to personal cash, in home currency), corporate
 * holders (to liquidCapital), and the public float (to the country's central
 * bank reserve). Mirrors the bucket handling of the dissolution settlement so
 * no slice is silently dropped.
 */
export async function settleFundedWholeCorpShareholderPool(
  db: Db,
  input: {
    countryId: CountryId;
    target: Corporation;
    poolAnchor: number;
    fxByCurrency: ReadonlyMap<CurrencyCode, number>;
    forexEnabled: boolean;
    ledger: TreasuryCashOptions;
    key: string;
    now: Date;
  }
): Promise<void> {
  const context = input.ledger.context;
  const settlementKey = `treasury-nationalization-buyout:${input.key}`;
  const prior = await db
    .collection<{ _id: string }>("bankMoneyMoves")
    .findOne({ _id: settlementKey });
  if (prior) {
    const resumed = await resumeSettlement(db, settlementKey);
    if (resumed.status !== "applied" && !(resumed.status === "replayed" && !resumed.error))
      throw new Error(resumed.error ?? "Funded shareholder buyout is incomplete");
    return;
  }
  if (!context?.treasuryCashLedgerEnabled) throw new Error("Funded buyout requires Treasury cash");

  const allocation = allocateShareholderPool(input.target, input.poolAnchor, new Map());
  const personalRows = allocation.characterRows.filter((row) => row.payout > 0);
  const corpRows = allocation.corporationRows.filter((row) => row.payout > 0);
  const fundRows = allocation.fundRows.filter((row) => row.payout > 0);
  const floatPayout = allocation.publicFloatRow?.payout ?? 0;
  const totalAnchor =
    personalRows.reduce((sum, row) => sum + row.payout, 0) +
    corpRows.reduce((sum, row) => sum + row.payout, 0) +
    fundRows.reduce((sum, row) => sum + row.payout, 0) +
    floatPayout;
  if (!(totalAnchor > 0)) return;

  const [personalDocs, imperialDocs, corpDocs, funds] = await Promise.all([
    db
      .collection<Character>("characters")
      .find({
        _id: {
          $in: personalRows
            .filter((row) => !row.isImperial)
            .map((row) => new ObjectId(row.characterId)),
        },
      })
      .toArray(),
    db
      .collection<ImperialCharacter>("imperialCharacters")
      .find({
        _id: {
          $in: personalRows
            .filter((row) => row.isImperial)
            .map((row) => new ObjectId(row.characterId)),
        },
      })
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: corpRows.map((row) => new ObjectId(row.corporationId)) } })
      .toArray(),
    db
      .collection<IndexFund>("indexFunds")
      .find({ _id: { $in: fundRows.map((row) => new ObjectId(row.fundId)) } })
      .toArray(),
  ]);
  const personalById = new Map(
    [...personalDocs, ...imperialDocs].map((doc) => [doc._id.toString(), doc])
  );
  const corpById = new Map(corpDocs.map((doc) => [doc._id.toString(), doc]));
  const fundById = new Map(funds.map((doc) => [doc._id.toString(), doc]));
  if (personalRows.some((row) => !personalById.has(row.characterId)))
    throw new Error("Funded buyout shareholder is missing");
  if (corpRows.some((row) => !corpById.has(row.corporationId)))
    throw new Error("Funded buyout corporate shareholder is missing");
  if (fundRows.some((row) => !fundById.has(row.fundId)))
    throw new Error("Funded buyout index-fund shareholder is missing");

  const treasuryCurrency =
    context.treasuryCurrencies.get(input.countryId) ??
    COUNTRY_CURRENCY_MAP[input.countryId] ??
    "USD";
  const treasuryRate = treasuryAnchorValuation({
    countryId: input.countryId,
    currencyCode: treasuryCurrency,
    preset: context.preset,
    observedRate: context.rates.get(treasuryCurrency),
  }).anchorRate;
  const treasuryLocal = Math.round(
    writeGovBudgetLocal(totalAnchor, treasuryCurrency, treasuryRate)
  );
  if (!(treasuryLocal > 0))
    throw new Error("Funded buyout rounded to a non-positive Treasury debit");
  const budget = await db
    .collection<{ countryId: string; currencyCode?: CurrencyCode | null }>("federalBudget")
    .findOne({ countryId: input.countryId }, { projection: { countryId: 1, currencyCode: 1 } });
  if (!budget) throw new Error("Funded buyout Treasury account is missing");
  const treasuryFilter: Record<string, unknown> = { countryId: budget.countryId };
  if (Object.prototype.hasOwnProperty.call(budget, "currencyCode"))
    treasuryFilter.currencyCode =
      budget.currencyCode === null ? { $type: 10 } : budget.currencyCode;
  else treasuryFilter.currencyCode = { $exists: false };
  const legs: TransitionLeg[] = [
    {
      kind: "debit",
      amount: treasuryLocal,
      valuation: { currencyCode: treasuryCurrency, localPerAnchor: treasuryLocal / totalAnchor },
      collection: "federalBudget",
      filter: { ...treasuryFilter, treasuryCashLocal: { $gte: treasuryLocal } },
      path: "treasuryCashLocal",
      note: "Fund whole-corporation nationalization shareholder pool",
    },
  ];
  if (floatPayout > 0) {
    const amount = Math.round(writeGovBudgetLocal(floatPayout, treasuryCurrency, treasuryRate));
    legs.push({
      kind: "credit",
      amount,
      valuation: { currencyCode: treasuryCurrency, localPerAnchor: amount / floatPayout },
      collection: "federalBudget",
      filter: treasuryFilter,
      path: "treasuryCashLocal",
      note: "Return the public-float shareholder allocation to Treasury",
    });
  }
  const requireRate = (currency: CurrencyCode): number => {
    const rate = input.fxByCurrency.get(currency);
    if (rate === undefined || !Number.isFinite(rate) || rate <= 0)
      throw new Error(`Missing funded buyout FX rate for ${currency}`);
    return rate;
  };
  for (const row of personalRows) {
    const holder = personalById.get(row.characterId)!;
    const currency = getHomeCurrency(holder);
    const local = input.forexEnabled ? row.payout * requireRate(currency) : row.payout;
    const path = Object.keys(buildPersonalBalanceInc(1, currency, input.forexEnabled))[0]!;
    const holderFilter: Record<string, unknown> = { _id: holder._id };
    if (input.forexEnabled) holderFilter.countryId = holder.countryId;
    legs.push({
      kind: "credit",
      amount: local,
      valuation: {
        currencyCode: input.forexEnabled ? currency : "USD",
        localPerAnchor: local / row.payout,
      },
      collection: row.isImperial ? "imperialCharacters" : "characters",
      filter: holderFilter,
      path,
      note: `Pay frozen personal shareholder ${row.characterId}`,
    });
  }
  for (const row of corpRows) {
    const holder = corpById.get(row.corporationId)!;
    const currency = resolveCorpLiquidCurrencyCode(holder);
    if (!currency)
      throw new Error(`Missing funded buyout currency for corporation ${row.corporationId}`);
    const rate = requireRate(currency);
    const local = Math.round(anchorToCorpLiquidCapital(row.payout, holder, rate));
    const filter: Record<string, unknown> = { _id: holder._id };
    if (holder.liquidCurrencyCode == null || !String(holder.liquidCurrencyCode).trim()) {
      filter.liquidCurrencyCode =
        holder.liquidCurrencyCode === undefined
          ? { $exists: false }
          : holder.liquidCurrencyCode === null
            ? { $type: 10 }
            : holder.liquidCurrencyCode;
      filter.countryId = holder.countryId === undefined ? { $exists: false } : holder.countryId;
    } else {
      filter.liquidCurrencyCode = holder.liquidCurrencyCode;
    }
    legs.push({
      kind: "credit",
      amount: local,
      valuation: { currencyCode: currency, localPerAnchor: local / row.payout },
      collection: "corporations",
      filter,
      path: "liquidCapital",
      note: `Pay frozen corporate shareholder ${row.corporationId}`,
    });
  }
  for (const row of fundRows) {
    legs.push({
      kind: "credit",
      amount: row.payout,
      valuation: { currencyCode: "USD", localPerAnchor: 1 },
      collection: "indexFunds",
      filter: {
        _id: new ObjectId(row.fundId),
        anchorCurrencyCode: fundById.get(row.fundId)!.anchorCurrencyCode,
      },
      path: "cashAnchor",
      note: `Pay frozen index-fund shareholder ${row.fundId}`,
    });
  }
  const projections = [
    {
      collection: "federalBudget",
      filter: treasuryFilter,
      update: {
        $inc: {
          treasuryBalance:
            -treasuryLocal +
            Math.round(writeGovBudgetLocal(floatPayout, treasuryCurrency, treasuryRate)),
        },
        $set: { updatedAt: input.now },
      },
      note: "Update signed fiscal position for funded shareholder buyout",
    },
  ];
  const transition: BankingTransition = {
    key: settlementKey,
    kind: "nationalization_shareholder_pool",
    turn: context.turn,
    currency: treasuryCurrency,
    retryCreditLegOnGuardFailure: true,
    legs,
    projections,
    event: {
      kind: "monetary.executed",
      command: "nationalization.whole_corporation_buyout",
      subjectType: "corporation",
      subjectId: input.target._id.toString(),
      amount: treasuryLocal,
      meta: { flow: "nationalization_buyout_pool", holders: legs.length - 1 },
    },
  };
  const settled = await settleTransition(db, transition);
  if (settled.status !== "applied" && !(settled.status === "replayed" && !settled.error))
    throw new Error(settled.error ?? "Funded shareholder buyout is incomplete");
}

export async function settleFundedWholeCorpLiquidation(
  db: Db,
  input: {
    countryId: CountryId;
    target: Corporation;
    ceo: Character | null;
    ceoSurplusAnchor: number;
    treasuryCashAnchor: number;
    liquidCapitalAnchor: number;
    fxByCurrency: ReadonlyMap<CurrencyCode, number>;
    forexEnabled: boolean;
    ledger: TreasuryCashOptions;
    key: string;
    now: Date;
  }
): Promise<void> {
  const context = input.ledger.context;
  const settlementKey = `treasury-nationalization-liquidation:${input.key}`;
  if (await db.collection<{ _id: string }>("bankMoneyMoves").findOne({ _id: settlementKey })) {
    const resumed = await resumeSettlement(db, settlementKey);
    if (resumed.status !== "applied" && !(resumed.status === "replayed" && !resumed.error))
      throw new Error(resumed.error ?? "Funded corporation liquidation is incomplete");
    return;
  }
  if (!context?.treasuryCashLedgerEnabled)
    throw new Error("Funded corporation liquidation requires Treasury cash");
  if (!(input.liquidCapitalAnchor > 0)) return;

  const sourceCurrency = resolveCorpLiquidCurrencyCode(input.target);
  if (!sourceCurrency) throw new Error("Funded corporation liquidation has no source currency");
  const sourceRate = input.fxByCurrency.get(sourceCurrency);
  if (sourceRate === undefined || !Number.isFinite(sourceRate) || sourceRate <= 0)
    throw new Error(`Missing funded liquidation FX rate for ${sourceCurrency}`);
  const sourceLocal = input.target.liquidCapital;
  if (!(sourceLocal > 0) || !Number.isFinite(sourceLocal))
    throw new Error("Funded corporation liquidation has no valid source cash");
  const legs: TransitionLeg[] = [
    {
      kind: "debit",
      amount: sourceLocal,
      valuation: {
        currencyCode: sourceCurrency,
        localPerAnchor: sourceLocal / input.liquidCapitalAnchor,
      },
      collection: "corporations",
      filter: {
        _id: input.target._id,
        liquidCapital: { $gte: sourceLocal },
        ...(input.target.liquidCurrencyCode === undefined
          ? { liquidCurrencyCode: { $exists: false } }
          : input.target.liquidCurrencyCode === null
            ? { liquidCurrencyCode: { $type: 10 } }
            : { liquidCurrencyCode: input.target.liquidCurrencyCode }),
        ...(!input.target.liquidCurrencyCode || !String(input.target.liquidCurrencyCode).trim()
          ? { countryId: input.target.countryId }
          : {}),
      },
      path: "liquidCapital",
      note: "Fund the dissolved corporation's frozen liquidation proceeds",
    },
  ];
  if (input.ceo && input.ceoSurplusAnchor > 0) {
    const currency = getHomeCurrency(input.ceo);
    const rate = input.forexEnabled ? input.fxByCurrency.get(currency) : 1;
    if (input.forexEnabled && (rate === undefined || !Number.isFinite(rate) || rate <= 0))
      throw new Error(`Missing funded liquidation FX rate for CEO currency ${currency}`);
    const local = input.forexEnabled ? input.ceoSurplusAnchor * rate! : input.ceoSurplusAnchor;
    const path = Object.keys(buildPersonalBalanceInc(1, currency, input.forexEnabled))[0]!;
    legs.push({
      kind: "credit",
      amount: local,
      valuation: {
        currencyCode: input.forexEnabled ? currency : "USD",
        localPerAnchor: local / input.ceoSurplusAnchor,
      },
      collection: "characters",
      filter: {
        _id: input.ceo._id,
        ...(input.forexEnabled ? { countryId: input.ceo.countryId } : {}),
      },
      path,
      note: "Pay the frozen executive share of corporation liquidation cash",
    });
  }
  const treasuryCurrency =
    context.treasuryCurrencies.get(input.countryId) ??
    COUNTRY_CURRENCY_MAP[input.countryId] ??
    "USD";
  const treasuryRate = treasuryAnchorValuation({
    countryId: input.countryId,
    currencyCode: treasuryCurrency,
    preset: context.preset,
    observedRate: context.rates.get(treasuryCurrency),
  }).anchorRate;
  const treasuryLocal = Math.round(
    writeGovBudgetLocal(input.treasuryCashAnchor, treasuryCurrency, treasuryRate)
  );
  let treasuryFilter: Record<string, unknown> | undefined;
  if (treasuryLocal > 0) {
    const budget = await db
      .collection<{ countryId: string; currencyCode?: CurrencyCode | null }>("federalBudget")
      .findOne({ countryId: input.countryId }, { projection: { countryId: 1, currencyCode: 1 } });
    if (!budget) throw new Error("Funded liquidation Treasury account is missing");
    treasuryFilter = { countryId: budget.countryId };
    if (Object.prototype.hasOwnProperty.call(budget, "currencyCode"))
      treasuryFilter.currencyCode =
        budget.currencyCode === null ? { $type: 10 } : budget.currencyCode;
    else treasuryFilter.currencyCode = { $exists: false };
    legs.push({
      kind: "credit",
      amount: treasuryLocal,
      valuation: {
        currencyCode: treasuryCurrency,
        localPerAnchor: treasuryLocal / input.treasuryCashAnchor,
      },
      collection: "federalBudget",
      filter: treasuryFilter,
      path: "treasuryCashLocal",
      note: "Return the frozen residual liquidation cash to Treasury",
    });
  }
  const transition: BankingTransition = {
    key: settlementKey,
    kind: "nationalization_corporation_liquidation",
    turn: context.turn,
    currency: sourceCurrency,
    legs,
    retryCreditLegOnGuardFailure: true,
    projections:
      treasuryLocal > 0 && treasuryFilter
        ? [
            {
              collection: "federalBudget",
              filter: treasuryFilter,
              update: { $inc: { treasuryBalance: treasuryLocal }, $set: { updatedAt: input.now } },
              note: "Update signed fiscal position after funded liquidation proceeds",
            },
          ]
        : [],
    event: {
      kind: "monetary.executed",
      command: "nationalization.corporation_liquidation",
      subjectType: "corporation",
      subjectId: input.target._id.toString(),
      amount: sourceLocal,
      meta: { flow: "corporation_liquidation" },
    },
  };
  const settled = await settleTransition(db, transition);
  if (settled.status !== "applied" && !(settled.status === "replayed" && !settled.error))
    throw new Error(settled.error ?? "Funded corporation liquidation is incomplete");
}

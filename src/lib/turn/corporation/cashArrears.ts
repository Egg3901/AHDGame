import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import type { Corporation } from "@/lib/db/types/corporation";
import type { TreasuryCashContext } from "@/lib/nationalization/treasuryLedger";
import { treasuryAnchorValuation } from "@/lib/budget/rules/treasuryAccrual";
import { settleTransition, resumeSettlement } from "@/lib/banking/settlementJournal";
import { oid, type BankingTransition } from "@/lib/banking/rules/boundary";

interface CashArrearsInput {
  db: Db;
  context: TreasuryCashContext;
  corporationId: string;
  currencyCode: CurrencyCode;
  localPerAnchor: number;
  turn: number;
  now: Date;
}

async function resumePending(db: Db, prefix: string): Promise<void> {
  const rows = await db
    .collection<{ _id: string; status?: string }>("bankMoneyMoves")
    .find({ _id: { $regex: `^${prefix}` }, status: "partial" }, { projection: { _id: 1 } })
    .toArray();
  for (const row of rows.sort((a, b) => a._id.localeCompare(b._id))) {
    const resumed = await resumeSettlement(db, row._id);
    if (resumed.status !== "applied" && resumed.status !== "replayed") {
      throw new Error(resumed.error ?? `Corporate arrears receipt ${row._id} is incomplete`);
    }
  }
}

/** Pay previously recorded obligations from later actual operating cash. */
export async function settlePriorCorporateCashArrears(input: CashArrearsInput): Promise<void> {
  const { db, context, corporationId, currencyCode, localPerAnchor, turn, now } = input;
  const operatingPrefix = `corp-operating-arrears-settle:${corporationId}:`;
  const taxPrefix = `corp-tax-arrears-settle:${corporationId}:`;
  await resumePending(db, operatingPrefix);
  await resumePending(db, taxPrefix);

  const projection = {
    liquidCapital: 1,
    operatingCashArrearsByCurrency: 1,
    operatingCashArrearsLastTurnByCurrency: 1,
    federalTaxArrearsAnchorByCountry: 1,
    federalTaxArrearsLastTurnByCountry: 1,
  };
  const corporations = db.collection<Corporation>("corporations");
  let corp = await corporations.findOne({ _id: new ObjectId(corporationId) }, { projection });
  if (!corp) return;
  let cash = Math.max(0, corp.liquidCapital ?? 0);

  const operatingTurn = corp.operatingCashArrearsLastTurnByCurrency?.[currencyCode];
  const operatingDue =
    operatingTurn == null || operatingTurn < turn
      ? Math.max(0, corp.operatingCashArrearsByCurrency?.[currencyCode] ?? 0)
      : 0;
  const operatingPaid = Math.min(cash, operatingDue);
  const operatingKey = `${operatingPrefix}${turn}`;
  if (operatingPaid > 0) {
    const existing = await db
      .collection<{ _id: string }>("bankMoneyMoves")
      .findOne({ _id: operatingKey });
    if (existing) {
      const resumed = await resumeSettlement(db, operatingKey);
      if (resumed.status !== "applied" && resumed.status !== "replayed") {
        throw new Error(resumed.error ?? `Operating arrears receipt ${operatingKey} is incomplete`);
      }
    } else {
      const valuation = { currencyCode, localPerAnchor };
      const transition: BankingTransition = {
        key: operatingKey,
        kind: "corporate_operating_arrears_payment",
        turn,
        currency: currencyCode,
        legs: [
          {
            kind: "debit",
            amount: operatingPaid,
            valuation,
            collection: "corporations",
            filter: { _id: oid(corporationId), liquidCapital: { $gte: operatingPaid } },
            path: "liquidCapital",
            note: "Pay prior operating arrears from realized corporation cash",
          },
          {
            kind: "burn",
            amount: operatingPaid,
            valuation,
            note: "Settle prior operating costs outside the corporation",
          },
        ],
        projections: [
          {
            collection: "corporations",
            filter: { _id: oid(corporationId) },
            update: {
              $inc: { [`operatingCashArrearsByCurrency.${currencyCode}`]: -operatingPaid },
              $set: {
                [`operatingCashArrearsLastTurnByCurrency.${currencyCode}`]: turn,
                updatedAt: now,
              },
            },
            note: "Reduce the corporation's payable by the funded payment",
          },
        ],
        event: {
          kind: "monetary.executed",
          command: "turn.corporation.operatingArrearsPayment",
          subjectType: "corporation",
          subjectId: corporationId,
          amount: operatingPaid,
          meta: { currencyCode, operatingArrearsLocal: operatingPaid },
        },
      };
      const settled = await settleTransition(db, transition);
      if (settled.status === "rejected") return;
      if (settled.status !== "applied" && settled.status !== "replayed") {
        throw new Error(settled.error ?? `Operating arrears receipt ${operatingKey} is incomplete`);
      }
    }
    cash -= operatingPaid;
    corp = await corporations.findOne({ _id: new ObjectId(corporationId) }, { projection });
    if (!corp) return;
    cash = Math.max(0, corp.liquidCapital ?? cash);
  }

  const taxDueByCountry = Object.fromEntries(
    Object.entries(corp.federalTaxArrearsAnchorByCountry ?? {}).filter(([country, amount]) => {
      const lastTurn = corp.federalTaxArrearsLastTurnByCountry?.[country as CountryId];
      return amount > 0 && (lastTurn == null || lastTurn < turn);
    })
  );
  let remainingAnchor = cash / localPerAnchor;
  const paidByCountry = new Map<string, number>();
  for (const [country, due] of Object.entries(taxDueByCountry).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    if (!(due > 0) || !(remainingAnchor > 0)) continue;
    const paid = Math.min(due, remainingAnchor);
    paidByCountry.set(country, paid);
    remainingAnchor -= paid;
  }
  const totalPaidAnchor = [...paidByCountry.values()].reduce((sum, amount) => sum + amount, 0);
  if (!(totalPaidAnchor > 0)) return;

  const taxKey = `${taxPrefix}${turn}`;
  const existingTax = await db
    .collection<{ _id: string }>("bankMoneyMoves")
    .findOne({ _id: taxKey });
  if (existingTax) {
    const resumed = await resumeSettlement(db, taxKey);
    if (resumed.status !== "applied" && resumed.status !== "replayed") {
      throw new Error(resumed.error ?? `Tax arrears receipt ${taxKey} is incomplete`);
    }
    return;
  }

  const debitLocal = totalPaidAnchor * localPerAnchor;
  const sourceValuation = { currencyCode, localPerAnchor };
  const legs: BankingTransition["legs"] = [
    {
      kind: "debit",
      amount: debitLocal,
      valuation: sourceValuation,
      collection: "corporations",
      filter: { _id: oid(corporationId), liquidCapital: { $gte: debitLocal } },
      path: "liquidCapital",
      note: "Settle prior federal tax arrears from later realized corporation cash",
    },
  ];
  const projections: BankingTransition["projections"] = [];
  for (const [country, amountAnchor] of paidByCountry) {
    const treasuryCurrency =
      context.treasuryCurrencies.get(country) ??
      COUNTRY_CURRENCY_MAP[country as CountryId] ??
      currencyCode;
    const treasuryRate = treasuryAnchorValuation({
      countryId: country,
      currencyCode: treasuryCurrency,
      preset: context.preset,
      observedRate: context.rates.get(treasuryCurrency),
    }).anchorRate;
    const treasuryLocal = amountAnchor * treasuryRate;
    legs.push({
      kind: "credit",
      amount: treasuryLocal,
      valuation: { currencyCode: treasuryCurrency, localPerAnchor: treasuryRate },
      collection: "federalBudget",
      filter: { countryId: country },
      path: "treasuryCashLocal",
      note: "Deliver prior tax arrears into spendable Treasury cash",
    });
    projections.push(
      {
        collection: "federalBudget",
        filter: { countryId: country },
        update: { $inc: { treasuryBalance: treasuryLocal }, $set: { updatedAt: now } },
        note: "Record the funded prior tax payment in signed fiscal-position analytics",
      },
      {
        collection: "corporations",
        filter: { _id: oid(corporationId) },
        update: {
          $inc: { [`federalTaxArrearsAnchorByCountry.${country}`]: -amountAnchor },
          $set: {
            [`federalTaxArrearsLastTurnByCountry.${country}`]: turn,
            updatedAt: now,
          },
        },
        note: "Reduce the tax payable by the funded payment",
      }
    );
  }
  const transition: BankingTransition = {
    key: taxKey,
    kind: "corporate_tax_arrears_payment",
    turn,
    currency: currencyCode,
    legs,
    projections,
    event: {
      kind: "monetary.executed",
      command: "turn.corporation.taxArrearsPayment",
      subjectType: "corporation",
      subjectId: corporationId,
      amount: debitLocal,
      meta: {
        paidTaxArrearsAnchor: totalPaidAnchor,
        paidTaxArrearsCountries: [...paidByCountry.keys()].join(","),
      },
    },
  };
  const settled = await settleTransition(db, transition);
  if (settled.status === "rejected") return;
  if (settled.status !== "applied" && settled.status !== "replayed") {
    throw new Error(settled.error ?? `Tax arrears receipt ${taxKey} is incomplete`);
  }
}

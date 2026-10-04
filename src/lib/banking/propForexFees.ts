/**
 * Investment-bank forex trades pay size and liquidity fees in their cash currency.
 * loadPropForexFeeQuote freezes the live quote; settlePendingPropForexFee delivers
 * the funded fee to the central bank without charging a later charter.
 */
import { ObjectId, type Db } from "mongodb";
import type { CentralBank, Corporation, ExchangeRate } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { recentVolumeAnchorOf } from "@/lib/currency/tradeFees";
import { settleTransition, resumeSettlement } from "./settlementJournal";
import { oid, type BankingTransition } from "./rules/boundary";
import {
  quotePropForexFee,
  recentPropForexVolume,
  type PropForexFeeReceipt,
} from "./rules/propForexFees";

export async function loadPropForexFeeQuote(
  db: Db,
  corporation: Pick<Corporation, "bankPropForexVolume">,
  currencyCode: CurrencyCode,
  foreignCurrency: CurrencyCode,
  units: number,
  turn: number
) {
  const docs = await db
    .collection<ExchangeRate>("exchangeRates")
    .find(
      { currencyCode: { $in: [currencyCode, foreignCurrency] } },
      {
        projection: {
          currencyCode: 1,
          rate: 1,
          forexSpreadStrength: 1,
          buyVolume24: 1,
          sellVolume24: 1,
        },
      }
    )
    .toArray();
  const home = docs.find((row) => row.currencyCode === currencyCode);
  const foreign = docs.find((row) => row.currencyCode === foreignCurrency);
  const homeRate = home?.rate;
  const foreignRate = foreign?.rate;
  if (
    !homeRate ||
    !foreignRate ||
    homeRate <= 0 ||
    foreignRate <= 0 ||
    !Number.isFinite(homeRate) ||
    !Number.isFinite(foreignRate)
  )
    throw new Error("Forex quote is unavailable");
  const markLocal = (units / foreignRate) * homeRate;
  const quote = quotePropForexFee({
    markLocal,
    currencyCode,
    homeRate,
    spreadStrength: home?.forexSpreadStrength,
    priorAnchor: recentPropForexVolume(corporation.bankPropForexVolume ?? [], turn),
    homeVolumeAnchor: recentVolumeAnchorOf(home),
    foreignVolumeAnchor: recentVolumeAnchorOf(foreign),
  });
  const centralBankId = getBankId(getCountryIdForCurrency(currencyCode));
  const bank = await db
    .collection<CentralBank>("centralBanks")
    .findOne({ _id: centralBankId }, { projection: { _id: 1 } });
  if (!bank) throw new Error("Forex settlement bank is unavailable");
  return { ...quote, markLocal, centralBankId };
}

/** The parent escrow survives failure/recharter; the frozen currency remains authoritative. */
export async function settlePendingPropForexFee(db: Db, bankId: ObjectId): Promise<boolean> {
  const corporation = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: bankId }, { projection: { bankPropForexFee: 1 } });
  const receipt = corporation?.bankPropForexFee;
  if (!receipt) return true;
  const identity = { _id: oid(bankId.toHexString()) };
  const bank = { _id: receipt.centralBankId };
  const transition: BankingTransition = {
    key: receipt.key,
    kind: "bank.prop.forex.fee",
    turn: receipt.turn,
    currency: receipt.currencyCode,
    legs: [
      {
        kind: "debit",
        amount: receipt.feeLocal,
        collection: "corporations",
        filter: {
          ...identity,
          "bankPropForexFee.key": receipt.key,
          "bankPropForexFee.amountLocal": { $gte: receipt.feeLocal },
        },
        path: "bankPropForexFee.amountLocal",
        note: "Pay reserved forex fee",
      },
      {
        kind: "credit",
        amount: receipt.revenueLocal,
        collection: "centralBanks",
        filter: bank,
        path: "forexRevenue",
        note: "Forex fee revenue in the bank cash currency",
      },
      {
        kind: "credit",
        amount: receipt.reserveLocal,
        collection: "centralBanks",
        filter: bank,
        path: `spreadFeeReserveBalances.${receipt.currencyCode}`,
        note: "Forex fee currency reserve",
      },
      { kind: "burn", amount: receipt.burnLocal, note: "Published forex fee burn share" },
    ],
    projections: [
      {
        collection: "corporations",
        filter: {
          ...identity,
          "bankPropForexFee.key": receipt.key,
          "bankPropForexFee.amountLocal": 0,
        },
        update: { $unset: { bankPropForexFee: "" } },
        note: "Release completed fee intent",
      },
    ],
    event: { kind: "prop.traded", command: "bank.prop.forex.fee", amount: receipt.feeLocal },
  };
  const claimed = await settleTransition(db, transition);
  const result = claimed.status === "replayed" ? await resumeSettlement(db, receipt.key) : claimed;
  return !result.error && (result.status === "applied" || result.status === "replayed");
}

export async function recoverPropForexFees(db: Db, turn: number): Promise<string[]> {
  const rows = await db
    .collection<Corporation>("corporations")
    .find({ "bankPropForexFee.turn": { $lt: turn } }, { projection: { _id: 1 } })
    .limit(200)
    .toArray();
  const unfinished: string[] = [];
  for (const row of rows)
    if (!(await settlePendingPropForexFee(db, row._id))) unfinished.push(row._id.toHexString());
  return unfinished;
}

export function propForexFeeReceipt(
  quote: Awaited<ReturnType<typeof loadPropForexFeeQuote>>,
  currencyCode: CurrencyCode,
  charteredTurn: number,
  turn: number
): PropForexFeeReceipt {
  return {
    key: "",
    turn,
    charteredTurn,
    currencyCode,
    centralBankId: quote.centralBankId,
    feeLocal: quote.feeLocal,
    revenueLocal: quote.revenueLocal,
    reserveLocal: quote.reserveLocal,
    burnLocal: quote.burnLocal,
  };
}

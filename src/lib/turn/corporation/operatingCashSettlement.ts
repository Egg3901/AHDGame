import type { Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { treasuryAnchorValuation } from "@/lib/budget/rules/treasuryAccrual";
import { snapshotTreasuryCurrency } from "@/lib/ledger/balanceSnapshot";
import type { CorpSnapshot } from "./types";
import { loadTreasuryCashContext } from "@/lib/nationalization/treasuryLedger";
import { settleTransition, resumeSettlement } from "@/lib/banking/settlementJournal";
import { oid, type BankingTransition } from "@/lib/banking/rules/boundary";

/**
 * Settle the operating cash source and its federal withholding from the same
 * immutable per-corporation turn quote. The source is realized modeled business
 * cash, never an annual federalBudget revenue projection. A positive gross
 * operating receipt is explicit; federal tax is then a guarded payer debit and
 * a native Treasury credit. The corporation's net change equals its existing
 * after-tax operating result.
 */
export async function settleCorporateOperatingCash(
  db: Db,
  snapshots: readonly CorpSnapshot[],
  turn: number,
  now: Date
): Promise<void> {
  if (snapshots.length === 0) return;
  const context = await loadTreasuryCashContext(db, turn);
  if (!context?.treasuryCashLedgerEnabled) {
    throw new Error(
      "Corporate operating cash settlement requires the enabled Treasury cash ledger"
    );
  }

  const journals = db.collection<{ _id: string }>("bankMoneyMoves");
  const keys = snapshots.map(
    (snapshot) => `corp-operating-cash:${turn}:${snapshot.corpId.toString()}`
  );
  const existingRows = await journals
    .find({ _id: { $in: keys } }, { projection: { _id: 1 } })
    .toArray();
  const existingKeys = new Set(existingRows.map((row) => row._id));
  for (const snapshot of snapshots) {
    const netLocal = snapshot.operatingCashIncomeLocal;
    const sourceCurrency = snapshot.operatingCashCurrency;
    const sourceRate = snapshot.operatingCashLocalPerAnchor;
    if (
      !Number.isFinite(netLocal) ||
      !sourceCurrency ||
      !Number.isFinite(sourceRate) ||
      !(sourceRate! > 0)
    ) {
      throw new Error(`Missing frozen operating cash quote for corporation ${snapshot.corpId}`);
    }
    const taxByCountry = snapshot.federalTaxByCountryAnchor ?? new Map<string, number>();
    const taxAnchor = [...taxByCountry.values()].reduce((sum, amount) => sum + amount, 0);
    const taxSourceLocal = taxAnchor * sourceRate!;
    const grossLocal = netLocal! + taxSourceLocal;
    const key = `corp-operating-cash:${turn}:${snapshot.corpId.toString()}`;

    if (existingKeys.has(key)) {
      const resumed = await resumeSettlement(db, key);
      if (resumed.status !== "applied" && resumed.status !== "replayed") {
        throw new Error(resumed.error ?? `Corporate operating cash receipt ${key} is incomplete`);
      }
      continue;
    }

    const legs: BankingTransition["legs"] = [];
    const projections: BankingTransition["projections"] = [];
    const sourceValuation = { currencyCode: sourceCurrency, localPerAnchor: sourceRate! };
    if (grossLocal > 0) {
      legs.push(
        {
          kind: "mint",
          amount: grossLocal,
          valuation: sourceValuation,
          note: "Realized gross modeled operating receipts",
        },
        {
          kind: "credit",
          amount: grossLocal,
          valuation: sourceValuation,
          collection: "corporations",
          filter: { _id: oid(snapshot.corpId.toString()) },
          path: "liquidCapital",
          note: "Credit modeled operating receipts before federal tax withholding",
        }
      );
    }
    if (taxSourceLocal > 0) {
      legs.push({
        kind: "debit",
        amount: taxSourceLocal,
        valuation: sourceValuation,
        collection: "corporations",
        filter: { _id: oid(snapshot.corpId.toString()), liquidCapital: { $gte: taxSourceLocal } },
        path: "liquidCapital",
        note: "Withhold federal corporate tax from the actual operating cash source",
      });
    }
    if (grossLocal < 0) {
      const operatingLossLocal = -grossLocal;
      legs.push(
        {
          kind: "debit",
          amount: operatingLossLocal,
          valuation: sourceValuation,
          collection: "corporations",
          filter: {
            _id: oid(snapshot.corpId.toString()),
            liquidCapital: { $gte: operatingLossLocal },
          },
          path: "liquidCapital",
          note: "Settle realized operating costs from corporation cash",
        },
        {
          kind: "burn",
          amount: operatingLossLocal,
          valuation: sourceValuation,
          note: "Operating cost paid outside the modeled corporation sector",
        }
      );
    }

    for (const [country, amountAnchor] of taxByCountry) {
      if (!(amountAnchor > 0)) continue;
      const treasuryCurrency =
        context.treasuryCurrencies.get(country) ??
        COUNTRY_CURRENCY_MAP[country as CountryId] ??
        snapshotTreasuryCurrency({ countryId: country as CountryId });
      const treasuryRate = treasuryAnchorValuation({
        countryId: country,
        currencyCode: treasuryCurrency,
        preset: context.preset,
        observedRate: context.rates.get(treasuryCurrency),
      }).anchorRate;
      const treasuryLocal = amountAnchor * treasuryRate;
      const valuation = { currencyCode: treasuryCurrency, localPerAnchor: treasuryRate };
      legs.push({
        kind: "credit",
        amount: treasuryLocal,
        valuation,
        collection: "federalBudget",
        filter: { countryId: country },
        path: "treasuryCashLocal",
        note: "Deliver withheld federal corporate tax into spendable Treasury cash",
      });
      projections.push({
        collection: "federalBudget",
        filter: { countryId: country },
        update: { $inc: { treasuryBalance: treasuryLocal }, $set: { updatedAt: now } },
        note: "Record the Treasury tax receipt in signed fiscal-position analytics",
      });
    }

    if (legs.length === 0) continue;
    const transition: BankingTransition = {
      key,
      kind: "corporate_operating_cash",
      turn,
      currency: sourceCurrency as CurrencyCode,
      legs,
      projections,
      event: {
        kind: "monetary.executed",
        command: "turn.corporation.operatingCash",
        subjectType: "corporation",
        subjectId: snapshot.corpId.toString(),
        amount: Math.max(0, grossLocal),
        meta: {
          grossOperatingCashLocal: grossLocal,
          federalTaxAnchor: taxAnchor,
          sourceCurrency,
          sourceLocalPerAnchor: sourceRate!,
        },
      },
    };
    const settled = await settleTransition(db, transition);
    if (settled.status !== "applied" && settled.status !== "replayed") {
      throw new Error(settled.error ?? `Corporate operating cash receipt ${key} is incomplete`);
    }
  }
}

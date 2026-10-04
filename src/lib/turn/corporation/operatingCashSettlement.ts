import { ObjectId, type Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { treasuryAnchorValuation } from "@/lib/budget/rules/treasuryAccrual";
import { snapshotTreasuryCurrency } from "@/lib/ledger/balanceSnapshot";
import type { CorpSnapshot } from "./types";
import type { Corporation } from "@/lib/db/types/corporation";
import { loadTreasuryCashContext } from "@/lib/nationalization/treasuryLedger";
import { settleTransition, resumeSettlement } from "@/lib/banking/settlementJournal";
import { oid, type BankingTransition } from "@/lib/banking/rules/boundary";
import { settlePriorCorporateCashArrears } from "./cashArrears";

/**
 * Settle modeled gross operating receipts before federal withholding. These
 * are separate durable receipts because the settlement journal applies
 * guarded debits before credits: one transition cannot spend income that has
 * not yet landed. Unfunded operating losses and withholding remain explicit
 * corporation arrears rather than aborting the whole corporation turn.
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

  const ids = snapshots.map((snapshot) => snapshot.corpId);
  const [journals, corporations] = await Promise.all([
    db.collection<{ _id: string }>("bankMoneyMoves"),
    db
      .collection<Corporation>("corporations")
      .find(
        { _id: { $in: ids } },
        {
          projection: {
            _id: 1,
            liquidCapital: 1,
            operatingCashArrearsByCurrency: 1,
            federalTaxArrearsAnchorByCountry: 1,
          },
        }
      )
      .toArray(),
  ]);
  const keys = snapshots.flatMap((snapshot) => {
    const base = `corp-operating-cash:${turn}:${snapshot.corpId.toString()}`;
    return [base, `${base}:gross`, `${base}:tax`, `${base}:arrears`];
  });
  const existingRows = await journals
    .find({ _id: { $in: keys } }, { projection: { _id: 1 } })
    .toArray();
  const existingKeys = new Set(existingRows.map((row) => row._id));
  const cashByCorpId = new Map(
    corporations.map((corp) => [corp._id.toString(), corp.liquidCapital])
  );

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
    const baseKey = `corp-operating-cash:${turn}:${snapshot.corpId.toString()}`;

    // Resume receipts created by the previous implementation before starting
    // the split gross/tax protocol. Its original journal already contains both
    // legs, so applying a second withholding would double-charge the corp.
    if (existingKeys.has(baseKey)) {
      const resumed = await resumeSettlement(db, baseKey);
      if (resumed.status !== "applied" && resumed.status !== "replayed") {
        throw new Error(
          resumed.error ?? `Corporate operating cash receipt ${baseKey} is incomplete`
        );
      }
      continue;
    }

    const grossKey = `${baseKey}:gross`;
    let availableCash = cashByCorpId.get(snapshot.corpId.toString()) ?? 0;
    if (existingKeys.has(grossKey)) {
      const resumed = await resumeSettlement(db, grossKey);
      if (resumed.status !== "applied" && resumed.status !== "replayed") {
        throw new Error(resumed.error ?? `Corporate gross receipt ${grossKey} is incomplete`);
      }
      const freshCorp = await db
        .collection<Corporation>("corporations")
        .findOne(
          { _id: new ObjectId(snapshot.corpId.toString()) },
          { projection: { liquidCapital: 1 } }
        );
      availableCash = freshCorp?.liquidCapital ?? availableCash;
    } else if (grossLocal > 0) {
      const valuation = { currencyCode: sourceCurrency, localPerAnchor: sourceRate! };
      const transition: BankingTransition = {
        key: grossKey,
        kind: "corporate_operating_gross_receipt",
        turn,
        currency: sourceCurrency as CurrencyCode,
        legs: [
          {
            kind: "mint",
            amount: grossLocal,
            valuation,
            note: "Realized modeled gross operating receipts",
          },
          {
            kind: "credit",
            amount: grossLocal,
            valuation,
            collection: "corporations",
            filter: { _id: oid(snapshot.corpId.toString()) },
            path: "liquidCapital",
            note: "Credit realized gross operating receipts before tax withholding",
          },
        ],
        projections: [],
        event: {
          kind: "monetary.executed",
          command: "turn.corporation.operatingGrossCash",
          subjectType: "corporation",
          subjectId: snapshot.corpId.toString(),
          amount: grossLocal,
          meta: {
            grossOperatingCashLocal: grossLocal,
            sourceCurrency,
            sourceLocalPerAnchor: sourceRate!,
          },
        },
      };
      const settled = await settleTransition(db, transition);
      if (settled.status !== "applied" && settled.status !== "replayed") {
        throw new Error(settled.error ?? `Corporate gross receipt ${grossKey} is incomplete`);
      }
      availableCash += grossLocal;
    }

    const originalCorp = corporations.find(
      (corp) => corp._id.toString() === snapshot.corpId.toString()
    );
    const hasOperatingArrears = Object.values(
      originalCorp?.operatingCashArrearsByCurrency ?? {}
    ).some((amount) => amount > 0);
    const hasTaxArrears = Object.values(originalCorp?.federalTaxArrearsAnchorByCountry ?? {}).some(
      (amount) => amount > 0
    );
    if (hasOperatingArrears || hasTaxArrears) {
      await settlePriorCorporateCashArrears({
        db,
        context,
        corporationId: snapshot.corpId.toString(),
        currencyCode: sourceCurrency as CurrencyCode,
        localPerAnchor: sourceRate!,
        turn,
        now,
      });
      const freshCorp = await db
        .collection<Corporation>("corporations")
        .findOne(
          { _id: new ObjectId(snapshot.corpId.toString()) },
          { projection: { liquidCapital: 1 } }
        );
      availableCash = Math.max(0, freshCorp?.liquidCapital ?? 0);
    }

    if (grossLocal < 0 && !existingKeys.has(grossKey)) {
      // Prior payables settle before the current turn's loss. Any remaining
      // cost becomes a currency-specific payable instead of negative cash.
      const loss = -grossLocal;
      const paidLoss = Math.min(loss, Math.max(0, availableCash));
      const shortfall = loss - paidLoss;
      const legs: BankingTransition["legs"] = [];
      const projections: BankingTransition["projections"] = [];
      const valuation = { currencyCode: sourceCurrency, localPerAnchor: sourceRate! };
      if (paidLoss > 0) {
        legs.push(
          {
            kind: "debit",
            amount: paidLoss,
            valuation,
            collection: "corporations",
            filter: { _id: oid(snapshot.corpId.toString()), liquidCapital: { $gte: paidLoss } },
            path: "liquidCapital",
            note: "Pay modeled operating costs from available corporation cash",
          },
          {
            kind: "burn",
            amount: paidLoss,
            valuation,
            note: "Settle funded operating costs outside the corporation",
          }
        );
      }
      if (shortfall > 0) {
        projections.push({
          collection: "corporations",
          filter: { _id: oid(snapshot.corpId.toString()) },
          update: {
            $inc: { [`operatingCashArrearsByCurrency.${sourceCurrency}`]: shortfall },
            $set: {
              [`operatingCashArrearsLastTurnByCurrency.${sourceCurrency}`]: turn,
              updatedAt: now,
            },
          },
          note: "Record the portion of this turn's operating loss not covered by cash",
        });
      }
      const transition: BankingTransition = {
        key: grossKey,
        kind: "corporate_operating_loss",
        turn,
        currency: sourceCurrency as CurrencyCode,
        legs,
        projections,
        event: {
          kind: "monetary.executed",
          command: "turn.corporation.operatingLoss",
          subjectType: "corporation",
          subjectId: snapshot.corpId.toString(),
          amount: -paidLoss,
          meta: {
            grossOperatingCashLocal: grossLocal,
            paidLossLocal: paidLoss,
            shortfallLocal: shortfall,
            sourceCurrency,
            sourceLocalPerAnchor: sourceRate!,
          },
        },
      };
      const settled = await settleTransition(db, transition);
      if (settled.status !== "applied" && settled.status !== "replayed") {
        throw new Error(settled.error ?? `Corporate operating loss ${grossKey} is incomplete`);
      }
    }

    if (!(taxSourceLocal > 0)) continue;
    const taxKey = `${baseKey}:tax`;
    const arrearsKey = `${baseKey}:arrears`;
    const recordTaxArrears = async () => {
      if (existingKeys.has(arrearsKey)) {
        const resumed = await resumeSettlement(db, arrearsKey);
        if (resumed.status !== "applied" && resumed.status !== "replayed") {
          throw new Error(resumed.error ?? `Corporate tax arrears ${arrearsKey} is incomplete`);
        }
        return;
      }
      const arrears: BankingTransition = {
        key: arrearsKey,
        kind: "corporate_tax_arrears",
        turn,
        currency: sourceCurrency as CurrencyCode,
        legs: [],
        projections: [
          {
            collection: "corporations",
            filter: { _id: oid(snapshot.corpId.toString()) },
            update: {
              $inc: Object.fromEntries(
                [...taxByCountry]
                  .filter(([, amount]) => amount > 0)
                  .map(([country, amount]) => [
                    `federalTaxArrearsAnchorByCountry.${country}`,
                    amount,
                  ])
              ),
              $set: {
                ...Object.fromEntries(
                  [...taxByCountry]
                    .filter(([, amount]) => amount > 0)
                    .map(([country]) => [`federalTaxArrearsLastTurnByCountry.${country}`, turn])
                ),
                updatedAt: now,
              },
            },
            note: "Record tax amounts due when current operating cash cannot fund withholding",
          },
        ],
        event: {
          kind: "monetary.executed",
          command: "turn.corporation.taxArrears",
          subjectType: "corporation",
          subjectId: snapshot.corpId.toString(),
          amount: 0,
          meta: { federalTaxArrearsAnchor: taxAnchor, sourceCurrency },
        },
      };
      const recorded = await settleTransition(db, arrears);
      if (recorded.status !== "applied" && recorded.status !== "replayed") {
        throw new Error(recorded.error ?? `Corporate tax arrears ${arrearsKey} is incomplete`);
      }
      existingKeys.add(arrearsKey);
    };
    if (existingKeys.has(taxKey)) {
      const resumed = await resumeSettlement(db, taxKey);
      if (resumed.status === "rejected") {
        await recordTaxArrears();
        continue;
      }
      if (resumed.status !== "applied" && resumed.status !== "replayed") {
        throw new Error(resumed.error ?? `Corporate tax receipt ${taxKey} is incomplete`);
      }
      continue;
    }

    const sourceValuation = { currencyCode: sourceCurrency, localPerAnchor: sourceRate! };
    const taxLegs: BankingTransition["legs"] = [
      {
        kind: "debit",
        amount: taxSourceLocal,
        valuation: sourceValuation,
        collection: "corporations",
        filter: { _id: oid(snapshot.corpId.toString()), liquidCapital: { $gte: taxSourceLocal } },
        path: "liquidCapital",
        note: "Withhold corporate tax from available realized operating cash",
      },
    ];
    const taxProjections: BankingTransition["projections"] = [];
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
      const treasuryValuation = { currencyCode: treasuryCurrency, localPerAnchor: treasuryRate };
      taxLegs.push({
        kind: "credit",
        amount: treasuryLocal,
        valuation: treasuryValuation,
        collection: "federalBudget",
        filter: { countryId: country },
        path: "treasuryCashLocal",
        note: "Deliver the payer-funded tax into spendable Treasury cash",
      });
      taxProjections.push({
        collection: "federalBudget",
        filter: { countryId: country },
        update: { $inc: { treasuryBalance: treasuryLocal }, $set: { updatedAt: now } },
        note: "Record the Treasury tax receipt in signed fiscal-position analytics",
      });
    }
    const taxTransition: BankingTransition = {
      key: taxKey,
      kind: "corporate_tax_withholding",
      turn,
      currency: sourceCurrency as CurrencyCode,
      legs: taxLegs,
      projections: taxProjections,
      event: {
        kind: "monetary.executed",
        command: "turn.corporation.taxWithholding",
        subjectType: "corporation",
        subjectId: snapshot.corpId.toString(),
        amount: taxSourceLocal,
        meta: {
          federalTaxAnchor: taxAnchor,
          sourceCurrency,
          sourceLocalPerAnchor: sourceRate!,
        },
      },
    };
    const taxed = await settleTransition(db, taxTransition);
    if (taxed.status === "rejected") {
      // Withholding that the corporation cannot fund is a payable, not a
      // Treasury receipt. Persist it once and let the ordinary insolvency path
      // see the shortfall; never mint the missing government cash.
      await recordTaxArrears();
      continue;
    }
    if (taxed.status !== "applied" && taxed.status !== "replayed") {
      throw new Error(taxed.error ?? `Corporate tax receipt ${taxKey} is incomplete`);
    }
  }
}

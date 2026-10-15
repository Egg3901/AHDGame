/**
 * Winning extraction bids settle signing fees through the existing journal in both
 * treasury modes. The concession activates only after the payment receipt completes.
 */
import type { Db } from "mongodb";
import { createHash } from "node:crypto";
import type { Corporation, ExtractionContract, StateBudget, FederalBudget } from "@/lib/db/types";
import {
  getCorpFxRate,
  anchorToCorpLiquidCapital,
  resolveCorpLiquidCurrencyCode,
  getCurrencyFxRate,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { loadTreasuryCashContext } from "@/lib/nationalization/treasuryLedger";
import { treasuryAnchorValuation } from "@/lib/budget/rules/treasuryAccrual";
import { settleTransition, resumeSettlement } from "@/lib/banking/settlementJournal";
import {
  oid,
  type BankingTransition,
  type TransitionProjection,
} from "@/lib/banking/rules/boundary";
import { signingFeeCredit } from "./rules/signingFee";
import { ContractError } from "./eligibility";
const logId = (key: string) => oid(createHash("sha256").update(key).digest("hex").slice(0, 24));
export async function settleTenderSigningFee(
  db: Db,
  contract: ExtractionContract,
  corp: Corporation,
  turn: number,
  now: Date,
  funded: boolean,
  allowNewSettlement = true
): Promise<{ ok: boolean; error?: string }> {
  if (!contract.tenderId)
    throw new ContractError("Only a winning tender may use this signing fee command.", 400);
  const col = db.collection<ExtractionContract>("extractionContracts");
  const amount = contract.signingFeeAnchor ?? 0;
  if (!allowNewSettlement && amount === 0 && !contract.signingFeeSettled)
    throw new ContractError("Extraction contract issuance is disabled.");
  if (amount > 0) {
    if (!contract.signingFeeAttemptKey)
      throw new Error("Tender signing fee is missing its frozen settlement identity.");
    const key = "extraction-signing-fee:" + contract.signingFeeAttemptKey;
    const prior = await db
      .collection<{ _id: string }>("bankMoneyMoves")
      .findOne({ _id: key }, { projection: { _id: 1 } });
    let result;
    if (prior) result = await resumeSettlement(db, key);
    else {
      // Paused issuance permits recovery only of an already journaled payment.
      // It never prepares a new financial transition or zero-fee concession.
      if (!allowNewSettlement) throw new ContractError("Extraction contract issuance is disabled.");
      const sourceCurrency = resolveCorpLiquidCurrencyCode(corp) ?? "USD";
      const sourceRate = await getCorpFxRate(db, corp);
      const sourceLocal = anchorToCorpLiquidCapital(amount, corp, sourceRate);
      const stateBudget =
        contract.grantedByLevel === "state"
          ? await db
              .collection<StateBudget>("stateBudgets")
              .findOne(
                { _id: contract.stateId, countryId: contract.countryId },
                { projection: { _id: 1 } }
              )
          : null;
      const national = contract.grantedByLevel === "national" || !stateBudget;
      const nationalBudget = await db
        .collection<FederalBudget>("federalBudget")
        .findOne({ countryId: contract.countryId }, { projection: { currencyCode: 1 } });
      let destinationCurrency = (nationalBudget?.currencyCode ??
        COUNTRY_CURRENCY_MAP[contract.countryId]) as CurrencyCode;
      let destinationRate = await getCurrencyFxRate(db, destinationCurrency);
      if (national && funded) {
        const cash = await loadTreasuryCashContext(db, turn);
        if (!cash?.treasuryCashLedgerEnabled)
          throw new ContractError(
            "The Treasury cash context is unavailable. Resume this award after it is restored."
          );
        destinationCurrency =
          cash.treasuryCurrencies.get(contract.countryId) ?? destinationCurrency;
        destinationRate = treasuryAnchorValuation({
          countryId: contract.countryId,
          currencyCode: destinationCurrency,
          preset: cash.preset,
          observedRate:
            cash.rates.get(destinationCurrency) ??
            (await getCurrencyFxRate(db, destinationCurrency)),
        }).anchorRate;
      }
      if (national && !nationalBudget)
        throw new ContractError("The recipient government's budget is unavailable.");
      const credit = signingFeeCredit(sourceLocal, sourceRate, destinationRate);
      if (!credit)
        throw new ContractError("The signing fee cannot be valued in the current currencies.");
      const projections: TransitionProjection[] = [];
      if (national && funded)
        projections.push({
          collection: "federalBudget",
          filter: { countryId: contract.countryId },
          update: { $inc: { treasuryBalance: credit.destinationLocal } },
          note: "Record the funded signing fee in the signed fiscal position",
        });
      const common = {
        turn,
        createdAt: now,
        meta: {
          contractId: contract._id.toHexString(),
          tenderId: contract.tenderId,
          stateId: contract.stateId,
          resource: contract.resource,
          grantedByLevel: contract.grantedByLevel,
        },
      };
      projections.push({
        collection: "financialTxLog",
        insert: {
          _id: logId(key + ":corporation"),
          ...common,
          type: "contract_signing_fee",
          subjectType: "corporation",
          subjectId: oid(corp._id.toHexString()),
          subjectName: corp.name,
          amount: -sourceLocal,
          currencyCode: sourceCurrency,
          anchorAmount: -credit.anchor,
        },
        note: "Record the corporation's signing fee",
      });
      if (national)
        projections.push({
          collection: "financialTxLog",
          insert: {
            _id: logId(key + ":government"),
            ...common,
            type: "govt_signing_fee_receipt",
            subjectType: "government",
            countryId: contract.countryId,
            subjectName: contract.countryId + " Government",
            amount: credit.destinationLocal,
            currencyCode: destinationCurrency,
            anchorAmount: credit.anchor,
          },
          note: "Record the government signing fee receipt",
        });
      projections.push({
        collection: "extractionContracts",
        filter: { _id: oid(contract._id.toHexString()) },
        update: { $set: { signingFeeSettled: true } },
        note: "Mark the signing fee complete before activating capacity",
      });
      const transition: BankingTransition = {
        key,
        kind: "extraction_contract_signing_fee",
        turn,
        currency: sourceCurrency,
        legs: [
          {
            kind: "debit",
            amount: sourceLocal,
            valuation: { currencyCode: sourceCurrency, localPerAnchor: sourceRate },
            collection: "corporations",
            filter: { _id: oid(corp._id.toHexString()), liquidCapital: { $gte: sourceLocal } },
            path: "liquidCapital",
            note: "Fund the winning extraction bid",
          },
          {
            kind: "credit",
            amount: credit.destinationLocal,
            valuation: { currencyCode: destinationCurrency, localPerAnchor: destinationRate },
            collection: national ? "federalBudget" : "stateBudgets",
            filter: national
              ? { countryId: contract.countryId }
              : { _id: contract.stateId, countryId: contract.countryId },
            path: national
              ? funded
                ? "treasuryCashLocal"
                : "treasuryBalance"
              : "revenue.resourceRoyalties",
            ...(national ? {} : { inc: { "revenue.total": credit.destinationLocal } }),
            note: "Deliver the signing fee to the issuing government",
          },
        ],
        projections,
        event: {
          kind: "monetary.executed",
          command: "government.contract.signingFee",
          subjectType: "corporation",
          subjectId: corp._id.toHexString(),
          amount: sourceLocal,
          meta: { contractId: contract._id.toHexString(), tenderId: contract.tenderId },
        },
      };
      result = await settleTransition(db, transition);
    }
    if (result.status === "rejected")
      return {
        ok: false,
        error: "The selected corporation cannot fund its signing fee. Choose another bid.",
      };
    if ((result.status !== "applied" && result.status !== "replayed") || result.error)
      throw new Error(result.error ?? "The signing fee requires settlement recovery.");
  }
  await col.updateOne(
    { _id: contract._id, status: "offered", revokedTurn: { $exists: false } },
    {
      $set: {
        status: "active",
        signingFeeSettled: true,
        activatedTurn: turn,
        expiresTurn: turn + (contract.termTurns ?? 24),
        updatedAt: now,
      },
    }
  );
  const active = await col.findOne(
    { _id: contract._id, status: "active", revokedTurn: { $exists: false } },
    { projection: { _id: 1 } }
  );
  if (!active)
    throw new ContractError("The paid concession could not be activated. Resume this award.");
  return { ok: true };
}

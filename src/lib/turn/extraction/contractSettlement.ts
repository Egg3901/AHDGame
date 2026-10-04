import { createHash } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import type { Corporation } from "@/lib/db/types/corporation";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import type { StateBudget } from "@/lib/db/types/budget";
import type { NotificationInput } from "@/lib/notifications";
import { createNotifications } from "@/lib/notifications";
import { getExtractionContractsCollection } from "@/lib/db/collections/extractionContracts";
import { getStateResourceCapacityCollection } from "@/lib/db/collections/stateResourceCapacity";
import { creditTreasury } from "@/lib/budget/treasurySpend";
import { emitTx, emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import {
  loadFxRatesByCurrency,
  anchorToCorpLiquidCapital,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { EXTRACTABLE_RESOURCES, COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import type { ExtractableResource, CommodityType } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";
import { CONTRACT_DEFAULT_MISSED_PAYMENTS } from "@/lib/constants/prospecting";
import { loadTreasuryCashContext } from "@/lib/nationalization/treasuryLedger";
import { treasuryAnchorValuation } from "@/lib/budget/rules/treasuryAccrual";
import { resumeSettlement, settleTransition } from "@/lib/banking/settlementJournal";
import { oid, type BankingTransition } from "@/lib/banking/rules/boundary";

export interface ContractSettlementResult {
  contractsSettled: number;
  royaltiesPaid: number;
  paymentsMissed: number;
  contractsDefaulted: number;
  offersExpired: number;
  contractsExpired: number;
  totalRoyaltyAnchor: number;
  /** Contracts whose issuer credit failed after the corp debit; the debit was
   * refunded and the settlement stamp rolled back so the retry re-charges. */
  errors: number;
}

/**
 * Royalty due for one turn, in ANCHOR units.
 *
 * royaltyDue = royaltyRatePerTurn × share × stateCapacity[resource] × price.
 * Commodity prices and COMMODITY_BASE_PRICES are anchor-calibrated, so the
 * product is anchor-denominated; the caller converts to the corp's and issuer's
 * currencies for the debit and credit legs.
 */
export function royaltyDueAnchor(
  royaltyRatePerTurn: number,
  share: number,
  stateCapacityUnits: number,
  priceAnchor: number
): number {
  if (royaltyRatePerTurn <= 0 || share <= 0 || stateCapacityUnits <= 0 || priceAnchor <= 0) {
    return 0;
  }
  return royaltyRatePerTurn * share * stateCapacityUnits * priceAnchor;
}

function stableRoyaltyLogId(key: string): ObjectId {
  return new ObjectId(createHash("sha256").update(key).digest("hex").slice(0, 24));
}

async function emitFundedRoyaltyLogs(
  db: Db,
  thresholds: Awaited<ReturnType<typeof loadTxThresholds>>,
  contract: ExtractionContract,
  corp: Corporation | undefined,
  turn: number,
  now: Date,
  receiptKey: string,
  quote: {
    anchorAmount: number;
    amountCorp: number;
    sourceCurrency: CurrencyCode;
    amountTreasury: number;
    treasuryCurrency: CurrencyCode;
  }
): Promise<void> {
  const sharedMeta = {
    contractId: contract._id.toString(),
    stateId: contract.stateId,
    resource: contract.resource,
    grantedByLevel: contract.grantedByLevel,
  };
  await emitTx(
    db,
    {
      type: "contract_royalty_payment",
      turn,
      createdAt: now,
      subjectType: "corporation",
      subjectId: contract.corporationId,
      subjectName: corp?.name ?? "Corporation",
      amount: -quote.amountCorp,
      currencyCode: quote.sourceCurrency,
      anchorAmount: -quote.anchorAmount,
      meta: sharedMeta,
    },
    thresholds,
    { _id: stableRoyaltyLogId(`${receiptKey}:payer`) }
  );
  await emitTx(
    db,
    {
      type: "govt_royalty_receipt",
      turn,
      createdAt: now,
      subjectType: "government",
      countryId: contract.countryId,
      subjectName: `${contract.countryId} Government`,
      amount: quote.amountTreasury,
      currencyCode: quote.treasuryCurrency,
      anchorAmount: quote.anchorAmount,
      meta: sharedMeta,
    },
    thresholds,
    { _id: stableRoyaltyLogId(`${receiptKey}:treasury`) }
  );
}

/**
 * Per-turn extraction-contract settlement (contract-issuance feature).
 *
 * For each ACTIVE contract with a royalty: charge the corp (atomic guarded
 * debit with FX conversion), credit the issuer (national treasury or a
 * persistent state-budget royalty line), and emit the royalty tx. Insufficient
 * funds increments missedPayments and defaults the contract at
 * CONTRACT_DEFAULT_MISSED_PAYMENTS. Also lapses expired offers and expired
 * terms. No-op is enforced by the registry (contractIssuanceEnabled gate).
 *
 * Ordering: this phase runs AFTER commodityPrices so `price` reflects this
 * turn's market.
 */
export async function settleExtractionContracts(
  db: Db,
  turn: number,
  now: Date,
  treasuryCashLedgerEnabled = false
): Promise<ContractSettlementResult> {
  const result: ContractSettlementResult = {
    contractsSettled: 0,
    royaltiesPaid: 0,
    paymentsMissed: 0,
    contractsDefaulted: 0,
    offersExpired: 0,
    contractsExpired: 0,
    totalRoyaltyAnchor: 0,
    errors: 0,
  };

  const contractsCol = await getExtractionContractsCollection(db);

  // ── Offer expiry: pending offers past their window lapse to `expired`. ──────
  const expiredOffers = await contractsCol
    .find({ status: "offered", offerExpiresTurn: { $lte: turn }, revokedTurn: { $exists: false } })
    .toArray();
  if (expiredOffers.length > 0) {
    await contractsCol.bulkWrite(
      expiredOffers.map((c) => ({
        updateOne: {
          filter: { _id: c._id },
          update: { $set: { status: "expired", revokedTurn: turn, updatedAt: now } },
        },
      }))
    );
    result.offersExpired = expiredOffers.length;
  }

  // ── Active contracts: term expiry + royalty settlement. ─────────────────────
  const activeContracts = await contractsCol
    .find({ status: "active", revokedTurn: { $exists: false } })
    .toArray();
  if (activeContracts.length === 0) return result;

  const treasuryCashContext = treasuryCashLedgerEnabled
    ? await loadTreasuryCashContext(db, turn)
    : null;
  if (treasuryCashLedgerEnabled && !treasuryCashContext?.treasuryCashLedgerEnabled) {
    throw new Error("Extraction royalties require the enabled Treasury cash ledger context");
  }

  // Batch-load supporting data.
  const stateIds = [...new Set(activeContracts.map((c) => c.stateId))];
  const capCol = await getStateResourceCapacityCollection(db);
  const [capDocs, priceDocs, fxByCurrency, thresholds, stateBudgets] = await Promise.all([
    capCol.find({ stateId: { $in: stateIds } }).toArray(),
    db
      .collection<CommodityPrice>("commodityPrices")
      .find({ commodity: { $in: EXTRACTABLE_RESOURCES as unknown as CommodityType[] } })
      .toArray(),
    loadFxRatesByCurrency(db),
    loadTxThresholds(db),
    treasuryCashLedgerEnabled
      ? db
          .collection<StateBudget>("stateBudgets")
          .find({ _id: { $in: [...new Set(activeContracts.map((contract) => contract.stateId))] } })
          .toArray()
      : Promise.resolve([] as StateBudget[]),
  ]);
  const capByKey = new Map<string, StateResourceCapacity>();
  for (const doc of capDocs) capByKey.set(`${doc.stateId}|${doc.countryId}`, doc);
  const priceByCommodity = new Map<string, CommodityPrice>();
  for (const doc of priceDocs) priceByCommodity.set(doc.commodity, doc);
  const stateBudgetKeys = new Set(
    stateBudgets.map((budget) => `${budget._id}|${budget.countryId}`)
  );
  const royaltyReceiptKeys = treasuryCashLedgerEnabled
    ? activeContracts.map((contract) => `extraction-royalty:${contract._id.toString()}:${turn}`)
    : [];
  const royaltyReceipts = treasuryCashLedgerEnabled
    ? await db
        .collection<{ _id: string; event?: { meta?: Record<string, unknown> } }>("bankMoneyMoves")
        .find({ _id: { $in: royaltyReceiptKeys } }, { projection: { _id: 1, event: 1 } })
        .toArray()
    : [];
  const royaltyReceiptByKey = new Map(royaltyReceipts.map((receipt) => [receipt._id, receipt]));

  const corpIds = [...new Set(activeContracts.map((c) => c.corporationId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const corpById = new Map<string, Corporation>();
  if (corpIds.length > 0) {
    const corps = await db
      .collection<Corporation>("corporations")
      .find(
        { _id: { $in: corpIds } },
        {
          projection: {
            userId: 1,
            name: 1,
            liquidCapital: 1,
            liquidCurrencyCode: 1,
            countryId: 1,
          },
        }
      )
      .toArray();
    for (const c of corps) corpById.set(c._id.toString(), c);
  }

  const notifications: NotificationInput[] = [];
  const txEntries: Parameters<typeof emitTxBulk>[1] = [];

  for (const contract of activeContracts) {
    // Term expiry takes precedence — an expiring contract is not charged.
    if (contract.expiresTurn != null && contract.expiresTurn <= turn) {
      await contractsCol.updateOne(
        { _id: contract._id },
        { $set: { status: "expired", revokedTurn: turn, updatedAt: now } }
      );
      result.contractsExpired += 1;
      const corp = corpById.get(contract.corporationId.toString());
      if (corp?.userId) {
        notifications.push(contractNotification(contract, corp.userId, "contract_expired"));
      }
      continue;
    }

    const fundedNational =
      treasuryCashLedgerEnabled &&
      (contract.grantedByLevel === "national" ||
        !stateBudgetKeys.has(`${contract.stateId}|${contract.countryId}`));

    const receiptKey = `extraction-royalty:${contract._id.toString()}:${turn}`;
    const priorRoyaltyReceipt = fundedNational ? royaltyReceiptByKey.get(receiptKey) : undefined;
    if (priorRoyaltyReceipt) {
      const resumed = await resumeSettlement(db, receiptKey);
      if (resumed.status !== "applied" && resumed.status !== "replayed") {
        throw new Error(resumed.error ?? `National royalty receipt ${receiptKey} is incomplete`);
      }
      const meta = priorRoyaltyReceipt.event?.meta ?? {};
      const anchorAmount = Number(meta.anchorAmount);
      const amountCorp = Number(meta.amountCorp);
      const amountTreasury = Number(meta.amountTreasury);
      const sourceCurrency = meta.sourceCurrency;
      const treasuryCurrency = meta.treasuryCurrency;
      if (
        !Number.isFinite(anchorAmount) ||
        !Number.isFinite(amountCorp) ||
        !Number.isFinite(amountTreasury) ||
        typeof sourceCurrency !== "string" ||
        typeof treasuryCurrency !== "string"
      ) {
        throw new Error(`National royalty receipt ${receiptKey} is missing its frozen quote`);
      }
      await emitFundedRoyaltyLogs(
        db,
        thresholds,
        contract,
        corpById.get(contract.corporationId.toString()),
        turn,
        now,
        receiptKey,
        {
          anchorAmount,
          amountCorp,
          sourceCurrency: sourceCurrency as CurrencyCode,
          amountTreasury,
          treasuryCurrency: treasuryCurrency as CurrencyCode,
        }
      );
      result.royaltiesPaid += 1;
      result.totalRoyaltyAnchor += anchorAmount;
      result.contractsSettled += 1;
      continue;
    }

    // Idempotency: a retried phase run must not double-charge. lastRoyaltyTurn
    // is stamped with every settlement outcome (paid AND missed) below.
    if (contract.lastRoyaltyTurn != null && contract.lastRoyaltyTurn >= turn) {
      continue;
    }

    // Legacy state-credit outcomes keep their original claim path. Funded
    // national outcomes stamp inside the durable settlement receipt instead.
    if (!fundedNational) {
      const settlementClaim = await contractsCol.updateOne(
        {
          _id: contract._id,
          status: "active",
          revokedTurn: { $exists: false },
          $or: [{ lastRoyaltyTurn: { $lt: turn } }, { lastRoyaltyTurn: { $exists: false } }],
        },
        { $set: { lastRoyaltyTurn: turn, updatedAt: now } }
      );
      if (settlementClaim.matchedCount === 0) continue;
    }

    const rate = contract.royaltyRatePerTurn ?? 0;
    if (rate <= 0) {
      if (fundedNational) {
        await contractsCol.updateOne(
          {
            _id: contract._id,
            status: "active",
            revokedTurn: { $exists: false },
            $or: [{ lastRoyaltyTurn: { $lt: turn } }, { lastRoyaltyTurn: { $exists: false } }],
          },
          { $set: { lastRoyaltyTurn: turn, updatedAt: now } }
        );
      }
      result.contractsSettled += 1;
      continue;
    }

    const capKey = `${contract.stateId}|${contract.countryId}`;
    const stateCapUnits =
      capByKey.get(capKey)?.resources?.[contract.resource as ExtractableResource] ?? 0;
    const priceDoc = priceByCommodity.get(contract.resource);
    const priceAnchor =
      priceDoc?.statePrices?.[contract.stateId] ??
      priceDoc?.globalPrice ??
      priceDoc?.basePrice ??
      COMMODITY_BASE_PRICES[contract.resource as ExtractableResource] ??
      0;

    const dueAnchor = royaltyDueAnchor(rate, contract.share, stateCapUnits, priceAnchor);
    if (dueAnchor <= 0) {
      if (fundedNational) {
        await contractsCol.updateOne(
          {
            _id: contract._id,
            status: "active",
            revokedTurn: { $exists: false },
            $or: [{ lastRoyaltyTurn: { $lt: turn } }, { lastRoyaltyTurn: { $exists: false } }],
          },
          { $set: { lastRoyaltyTurn: turn, updatedAt: now } }
        );
      }
      result.contractsSettled += 1;
      continue;
    }

    const corp = corpById.get(contract.corporationId.toString());
    if (!corp) {
      // Corp vanished (dissolved); leave the contract for revoke/cleanup elsewhere.
      if (fundedNational) {
        await contractsCol.updateOne(
          {
            _id: contract._id,
            status: "active",
            revokedTurn: { $exists: false },
            $or: [{ lastRoyaltyTurn: { $lt: turn } }, { lastRoyaltyTurn: { $exists: false } }],
          },
          { $set: { lastRoyaltyTurn: turn, updatedAt: now } }
        );
      }
      result.contractsSettled += 1;
      continue;
    }

    const corpCode = resolveCorpLiquidCurrencyCode(corp);
    const corpFxRate = corpCode ? (fxByCurrency.get(corpCode) ?? 1) : 1;
    const amountCorp = anchorToCorpLiquidCapital(dueAnchor, corp, corpFxRate);

    if (fundedNational) {
      const countryId = contract.countryId as CountryId;
      const countryCurrency =
        treasuryCashContext!.treasuryCurrencies.get(countryId) ??
        (COUNTRY_CURRENCY_MAP[countryId] as CurrencyCode | undefined);
      if (!countryCurrency) throw new Error(`Missing Treasury currency for ${countryId}`);
      const treasuryRate = treasuryAnchorValuation({
        countryId,
        currencyCode: countryCurrency,
        preset: treasuryCashContext!.preset,
        observedRate: treasuryCashContext!.rates.get(countryCurrency),
      }).anchorRate;
      const amountTreasury = dueAnchor * treasuryRate;
      const sourceCurrency = (corpCode ?? "USD") as CurrencyCode;
      const sourceRate = corpCode ? corpFxRate : 1;
      const receiptKey = `extraction-royalty:${contract._id.toString()}:${turn}`;

      if ((corp.liquidCapital ?? 0) < amountCorp) {
        const missed = (contract.missedPayments ?? 0) + 1;
        const defaulted = missed >= CONTRACT_DEFAULT_MISSED_PAYMENTS;
        const recordedMiss = await contractsCol.updateOne(
          {
            _id: contract._id,
            status: "active",
            revokedTurn: { $exists: false },
            $or: [{ lastRoyaltyTurn: { $lt: turn } }, { lastRoyaltyTurn: { $exists: false } }],
          },
          {
            $set: {
              missedPayments: missed,
              lastRoyaltyTurn: turn,
              updatedAt: now,
              ...(defaulted ? { status: "defaulted", revokedTurn: turn } : {}),
            },
          }
        );
        if (recordedMiss.matchedCount > 0) {
          result.paymentsMissed += 1;
          if (corp.userId) {
            notifications.push(
              contractNotification(
                contract,
                corp.userId,
                defaulted ? "contract_defaulted" : "contract_royalty_missed",
                { missedPayments: missed }
              )
            );
          }
          if (defaulted) result.contractsDefaulted += 1;
          result.contractsSettled += 1;
        }
        continue;
      }

      const transition: BankingTransition = {
        key: receiptKey,
        kind: "extraction_contract_royalty",
        turn,
        currency: sourceCurrency,
        legs: [
          {
            kind: "debit",
            amount: amountCorp,
            valuation: { currencyCode: sourceCurrency, localPerAnchor: sourceRate },
            collection: "corporations",
            filter: {
              _id: oid(corp._id.toString()),
              liquidCapital: { $gte: amountCorp },
            },
            path: "liquidCapital",
            note: "Debit the royalty from actual corporation cash",
          },
          {
            kind: "credit",
            amount: amountTreasury,
            valuation: { currencyCode: countryCurrency, localPerAnchor: treasuryRate },
            collection: "federalBudget",
            filter: { countryId },
            path: "treasuryCashLocal",
            note: "Credit payer-funded national royalty to spendable Treasury cash",
          },
        ],
        projections: [
          {
            collection: "federalBudget",
            filter: { countryId },
            update: { $inc: { treasuryBalance: amountTreasury }, $set: { updatedAt: now } },
            note: "Record funded royalty in signed fiscal-position analytics",
          },
          {
            collection: "extractionContracts",
            filter: {
              _id: oid(contract._id.toString()),
              status: "active",
              revokedTurn: { $exists: false },
            },
            update: {
              $set: {
                lastRoyaltyTurn: turn,
                missedPayments: 0,
                updatedAt: now,
              },
            },
            note: "Stamp the contract only after its funded national royalty is delivered",
          },
        ],
        event: {
          kind: "monetary.executed",
          command: "turn.extractionContract.royalty",
          subjectType: "corporation",
          subjectId: corp._id.toString(),
          amount: amountCorp,
          meta: {
            contractId: contract._id.toString(),
            stateId: contract.stateId,
            resource: contract.resource,
            grantedByLevel: contract.grantedByLevel,
            anchorAmount: dueAnchor,
            amountCorp,
            sourceCurrency,
            sourceLocalPerAnchor: sourceRate,
            amountTreasury,
            treasuryCurrency: countryCurrency,
            treasuryLocalPerAnchor: treasuryRate,
          },
        },
      };
      const settled = await settleTransition(db, transition);
      if (settled.status !== "applied" && settled.status !== "replayed") {
        throw new Error(settled.error ?? `National royalty receipt ${receiptKey} is incomplete`);
      }

      await emitFundedRoyaltyLogs(db, thresholds, contract, corp, turn, now, receiptKey, {
        anchorAmount: dueAnchor,
        amountCorp,
        sourceCurrency,
        amountTreasury,
        treasuryCurrency: countryCurrency,
      });
      result.royaltiesPaid += 1;
      result.totalRoyaltyAnchor += dueAnchor;
      result.contractsSettled += 1;
      continue;
    }

    // Atomic guarded debit: only succeeds if the corp can cover the payment.
    const debit = await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: corp._id, liquidCapital: { $gte: amountCorp } },
        { $inc: { liquidCapital: -amountCorp }, $set: { updatedAt: now } }
      );

    if (debit.modifiedCount === 0) {
      // Insufficient funds → missed payment; default at the threshold.
      const missed = (contract.missedPayments ?? 0) + 1;
      const defaulted = missed >= CONTRACT_DEFAULT_MISSED_PAYMENTS;
      await contractsCol.updateOne(
        { _id: contract._id },
        {
          $set: {
            missedPayments: missed,
            lastRoyaltyTurn: turn,
            updatedAt: now,
            ...(defaulted ? { status: "defaulted", revokedTurn: turn } : {}),
          },
        }
      );
      result.paymentsMissed += 1;
      if (corp.userId) {
        notifications.push(
          contractNotification(
            contract,
            corp.userId,
            defaulted ? "contract_defaulted" : "contract_royalty_missed",
            { missedPayments: missed }
          )
        );
      }
      if (defaulted) result.contractsDefaulted += 1;
      result.contractsSettled += 1;
      continue;
    }

    // The marker was claimed before the debit. Reset the missed-payment counter
    // after a successful payment.
    await contractsCol.updateOne(
      { _id: contract._id, lastRoyaltyTurn: turn },
      {
        $set: {
          updatedAt: now,
          ...((contract.missedPayments ?? 0) > 0 ? { missedPayments: 0 } : {}),
        },
      }
    );

    // Credit the issuer in its local currency. Compensation on failure (same
    // pattern as acceptContractOffer): the corp is already debited and the
    // idempotency stamp already set, so a throw here must refund the corp and
    // roll the contract back to its prior settlement state — otherwise the
    // money vanishes AND the same-turn retry would skip the contract.
    const countryId = contract.countryId as CountryId;
    const countryCode = COUNTRY_CURRENCY_MAP[countryId] as CurrencyCode | undefined;
    const countryFxRate = countryCode ? (fxByCurrency.get(countryCode) ?? 1) : 1;
    const amountLocal = dueAnchor * countryFxRate;

    try {
      let creditedNationalTreasury = false;
      if (contract.grantedByLevel === "national") {
        await creditTreasury(db, countryId, amountLocal);
        creditedNationalTreasury = true;
      } else {
        // State issuer → persistent state-budget royalty revenue line. $inc both
        // the dedicated field and total; calculateStateRevenue preserves + refolds
        // resourceRoyalties on the annual recompute so this survives.
        const stateCredit = await db.collection<StateBudget>("stateBudgets").updateOne(
          { _id: contract.stateId, countryId },
          {
            $inc: { "revenue.resourceRoyalties": amountLocal, "revenue.total": amountLocal },
            $set: { updatedAt: now },
          }
        );
        if (stateCredit.matchedCount === 0) {
          // Money conservation: the corp has already been debited but the state
          // budget doc is missing (never blind-upsert — StateBudget has a
          // required fiscal shape the recompute depends on). Route the royalty
          // to the national treasury as custodian so the money does not vanish.
          await creditTreasury(db, countryId, amountLocal);
          creditedNationalTreasury = true;
        }
      }

      txEntries.push({
        type: "contract_royalty_payment",
        turn,
        createdAt: now,
        subjectType: "corporation",
        subjectId: corp._id,
        subjectName: corp.name ?? "Corporation",
        amount: -amountCorp,
        currencyCode: (corpCode ?? "USD") as CurrencyCode,
        anchorAmount: -dueAnchor,
        meta: {
          contractId: contract._id.toString(),
          stateId: contract.stateId,
          resource: contract.resource,
          grantedByLevel: contract.grantedByLevel,
        },
      });
      // Paired government receipt — ONLY when the national treasury was credited
      // (federalBudget.treasuryBalance is the sole ledger-backed government
      // balance; state-budget credits stay single-sided). Same convention as
      // corp_tax_paid ↔ gov_tax_revenue, netted under the shared
      // "extraction_royalty" reason in deriveFromTx.
      if (creditedNationalTreasury) {
        txEntries.push({
          type: "govt_royalty_receipt",
          turn,
          createdAt: now,
          subjectType: "government",
          countryId,
          subjectName: `${countryId} Government`,
          amount: amountLocal,
          currencyCode: (countryCode ?? "USD") as CurrencyCode,
          anchorAmount: dueAnchor,
          meta: {
            contractId: contract._id.toString(),
            stateId: contract.stateId,
            resource: contract.resource,
            grantedByLevel: contract.grantedByLevel,
          },
        });
      }
    } catch (error) {
      // Refund the corp (additive $inc, no guard needed) and restore the
      // contract's prior settlement state so the retry re-charges: prior
      // lastRoyaltyTurn (or $unset when it was absent) and prior missedPayments
      // when the stamp reset it. Then keep the phase alive for the remaining
      // contracts — one issuer failure must not kill the whole settlement run.
      await db
        .collection<Corporation>("corporations")
        .updateOne(
          { _id: corp._id },
          { $inc: { liquidCapital: amountCorp }, $set: { updatedAt: now } }
        );
      await contractsCol.updateOne(
        { _id: contract._id },
        {
          $set: {
            updatedAt: now,
            ...(contract.lastRoyaltyTurn != null
              ? { lastRoyaltyTurn: contract.lastRoyaltyTurn }
              : {}),
            ...((contract.missedPayments ?? 0) > 0
              ? { missedPayments: contract.missedPayments }
              : {}),
          },
          ...(contract.lastRoyaltyTurn == null ? { $unset: { lastRoyaltyTurn: "" } } : {}),
        }
      );
      console.error(
        `[contractSettlement] issuer credit failed for contract ${contract._id.toString()}; corp refunded + stamp rolled back`,
        error
      );
      result.errors += 1;
      continue;
    }

    result.royaltiesPaid += 1;
    result.totalRoyaltyAnchor += dueAnchor;
    result.contractsSettled += 1;
  }

  if (txEntries.length > 0) await emitTxBulk(db, txEntries, thresholds);
  if (notifications.length > 0) await createNotifications(notifications);

  return result;
}

type ContractNotifType = "contract_royalty_missed" | "contract_defaulted" | "contract_expired";

function contractNotification(
  contract: ExtractionContract,
  userId: ObjectId,
  type: ContractNotifType,
  extra: Record<string, unknown> = {}
): NotificationInput {
  const metadata = {
    contractId: contract._id.toString(),
    stateId: contract.stateId,
    resource: contract.resource,
    ...extra,
  };
  const copy: Record<ContractNotifType, { title: string; message: string }> = {
    contract_royalty_missed: {
      title: "Missed Extraction Royalty",
      message: `Your company could not cover the royalty on its ${contract.resource} contract in ${contract.stateId}. Add funds before the contract defaults.`,
    },
    contract_defaulted: {
      title: "Extraction Contract Defaulted",
      message: `Your ${contract.resource} extraction contract in ${contract.stateId} defaulted after too many missed royalty payments and has been terminated.`,
    },
    contract_expired: {
      title: "Extraction Contract Expired",
      message: `Your ${contract.resource} extraction contract in ${contract.stateId} reached the end of its term and has expired.`,
    },
  };
  return { userId, type, title: copy[type].title, message: copy[type].message, metadata };
}

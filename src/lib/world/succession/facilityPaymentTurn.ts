/**
 * Successors compensate private firms for facilities lost in a federation split.
 * materializeFacilityPaymentTurn pays from available cash, locks the live firm
 * exchange rate in a receipt and leaves protected or unfunded claims outstanding.
 */
import { ObjectId, type AnyBulkWriteOperation, type ClientSession, type Db } from "mongodb";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { planFacilityPayments } from "./rules/facilityPayments";
import {
  FEDERATION_FACILITY_CLAIMS_COLLECTION,
  type FederationFacilityClaimRecord,
} from "./facilityClaimLedger";
import {
  FEDERATION_FISCAL_ACCOUNTS_COLLECTION,
  type FederationFiscalAccount,
} from "./materializeFiscalAccounts";
import {
  FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION,
  WORLD_ENTITY_STATES_COLLECTION,
  type FederationSettlementApplicationRecord,
  type RuntimeWorldEntityState,
  validateAppliedEntityStates,
} from "./runtimeEntities";

export const FEDERATION_FACILITY_PAYMENT_TURNS_COLLECTION = "federationFacilityPaymentTurns";
interface PaymentFirm {
  _id: ObjectId;
  countryId?: string;
  liquidCurrencyCode?: CurrencyCode;
  liquidCapital: number;
  federationPendingHeadquartersId?: string | null;
}
interface SuccessorCash {
  _id: string;
  presetId: string;
  simulationTier: string;
  federationTreasuryMinor?: number;
}
export interface FederationFacilityPaymentTurn {
  _id: string;
  applicationId: string;
  turn: number;
  paidMinor: number;
  successorPaymentsMinor: Record<string, number>;
  deferredClaimIds: string[];
  payments: {
    claimId: string;
    corporationId: string;
    paidMinor: number;
    currencyCode: CurrencyCode | null;
    rate: number;
    localAmount: number;
  }[];
  createdAt: Date;
}

export async function materializeFacilityPaymentTurn(input: {
  db: Db;
  session: ClientSession;
  applicationId: string;
  turn: number;
  now: Date;
}): Promise<FederationFacilityPaymentTurn> {
  const { db, session, applicationId, turn, now } = input;
  if (
    !session.inTransaction() ||
    !applicationId ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Facility payment needs an active transaction and valid turn");
  const receipts = db.collection<FederationFacilityPaymentTurn>(
    FEDERATION_FACILITY_PAYMENT_TURNS_COLLECTION
  );
  const receiptId = `${applicationId}:${turn}`;
  const previous = await receipts.findOne({ _id: receiptId }, { session });
  if (previous) return previous;
  const application = await db
    .collection<FederationSettlementApplicationRecord>(
      FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION
    )
    .findOne({ _id: applicationId, status: "applied", presetId: "1991-default" }, { session });
  // New settlements activate after this phase and first service claims next turn.
  if (!application || application.appliedOnTurn >= turn)
    throw new Error("Facility payment requires an earlier applied settlement");
  const entities = await db
    .collection<RuntimeWorldEntityState>(WORLD_ENTITY_STATES_COLLECTION)
    .find({ applicationId }, { session })
    .toArray();
  validateAppliedEntityStates(application.presetId, [application], entities);
  const claimCollection = db.collection<FederationFacilityClaimRecord>(
    FEDERATION_FACILITY_CLAIMS_COLLECTION
  );
  const claims = await claimCollection
    .find({ applicationId, status: "payable" }, { session })
    .toArray();
  const receipt: FederationFacilityPaymentTurn = {
    _id: receiptId,
    applicationId,
    turn,
    paidMinor: 0,
    successorPaymentsMinor: {},
    deferredClaimIds: [],
    payments: [],
    createdAt: now,
  };
  if (!claims.length) {
    await receipts.insertOne(receipt, { session });
    return receipt;
  }
  const debtorIds = [...new Set(claims.map((claim) => claim.debtorEntityId))].sort();
  const accounts = await db
    .collection<FederationFiscalAccount>(FEDERATION_FISCAL_ACCOUNTS_COLLECTION)
    .find(
      { applicationId, entityId: { $in: debtorIds }, kind: "background-successor" },
      { session }
    )
    .toArray();
  const macros = await db
    .collection<SuccessorCash>("macroCountries")
    .find(
      {
        _id: { $in: debtorIds },
        presetId: application.presetId,
        simulationTier: "background-macro",
      },
      { session, projection: { federationTreasuryMinor: 1, presetId: 1, simulationTier: 1 } }
    )
    .toArray();
  const accountsById = new Map(accounts.map((account) => [account.entityId, account]));
  const macrosById = new Map(macros.map((macro) => [macro._id, macro]));
  if (
    accountsById.size !== debtorIds.length ||
    accounts.length !== debtorIds.length ||
    macrosById.size !== debtorIds.length
  )
    throw new Error("Facility payment lacks approved successor accounts");
  const firmIds = [...new Set(claims.map((claim) => claim.corporationId))];
  if (firmIds.some((id) => !ObjectId.isValid(id)))
    throw new Error("Facility claim has an invalid firm identity");
  const firms = await db
    .collection<PaymentFirm>("corporations")
    .find(
      { _id: { $in: firmIds.map((id) => new ObjectId(id)) } },
      {
        session,
        projection: {
          countryId: 1,
          liquidCurrencyCode: 1,
          liquidCapital: 1,
          federationPendingHeadquartersId: 1,
        },
      }
    )
    .toArray();
  const firmById = new Map(firms.map((firm) => [firm._id.toHexString(), firm]));
  const eligible: FederationFacilityClaimRecord[] = [];
  for (const claim of claims) {
    const account = accountsById.get(claim.debtorEntityId)!;
    const minor = Math.round(claim.amountAnchor * 100);
    if (
      claim._id !== `${applicationId}:${claim.claimId}` ||
      !account.claimIds.includes(claim.claimId) ||
      !Number.isFinite(claim.amountAnchor) ||
      claim.amountAnchor < 0 ||
      !Number.isSafeInteger(minor) ||
      !Number.isSafeInteger(claim.paidMinor ?? 0) ||
      (claim.paidMinor ?? 0) < 0 ||
      (claim.paidMinor ?? 0) > minor
    )
      throw new Error("Facility payment liability changed");
    const firm = firmById.get(new ObjectId(claim.corporationId).toHexString());
    if (
      !firm ||
      !claim.creditorCountryId ||
      firm.countryId !== claim.creditorCountryId ||
      firm.federationPendingHeadquartersId
    ) {
      receipt.deferredClaimIds.push(claim.claimId);
      continue;
    }
    if (!Number.isFinite(firm.liquidCapital))
      throw new Error("Facility creditor has an invalid cash balance");
    eligible.push(claim);
  }
  const codes = [
    ...new Set(
      eligible
        .map((claim) =>
          resolveCorpLiquidCurrencyCode(
            firmById.get(new ObjectId(claim.corporationId).toHexString())
          )
        )
        .filter((code): code is CurrencyCode => !!code)
    ),
  ];
  const rates = await db
    .collection<{ currencyCode: CurrencyCode; rate: number }>("exchangeRates")
    .find({ currencyCode: { $in: codes } }, { session, projection: { currencyCode: 1, rate: 1 } })
    .toArray();
  const rateByCode = new Map(rates.map((rate) => [rate.currencyCode, rate.rate]));
  if (
    rates.length !== codes.length ||
    codes.some((code) => !Number.isFinite(rateByCode.get(code)) || rateByCode.get(code)! <= 0)
  )
    throw new Error("Facility compensation lacks a unique prevailing exchange rate");
  const claimWrites: AnyBulkWriteOperation<FederationFacilityClaimRecord>[] = [];
  const macroWrites: AnyBulkWriteOperation<SuccessorCash>[] = [];
  const firmCredits = new Map<string, number>();
  for (const debtorId of debtorIds) {
    const macro = macrosById.get(debtorId)!;
    if (!Number.isSafeInteger(macro.federationTreasuryMinor))
      throw new Error("Facility payment lacks successor treasury cash");
    const inventory = eligible.filter((claim) => claim.debtorEntityId === debtorId);
    const plan = planFacilityPayments(
      macro.federationTreasuryMinor!,
      inventory.map((claim) => ({
        id: claim._id,
        amountMinor: Math.round(claim.amountAnchor * 100),
        paidMinor: claim.paidMinor ?? 0,
      }))
    );
    receipt.successorPaymentsMinor[debtorId] = plan.paidMinor;
    receipt.paidMinor += plan.paidMinor;
    if (!Number.isSafeInteger(receipt.paidMinor))
      throw new Error("Facility payment exceeds shared accounting precision");
    if (plan.paidMinor)
      macroWrites.push({
        updateOne: {
          filter: { _id: debtorId, federationTreasuryMinor: macro.federationTreasuryMinor },
          update: { $set: { federationTreasuryMinor: plan.treasuryAfterMinor } },
        },
      });
    const byId = new Map(inventory.map((claim) => [claim._id, claim]));
    for (const payment of plan.claims) {
      const claim = byId.get(payment.id)!;
      if (!payment.paymentMinor && !payment.complete) continue;
      claimWrites.push({
        updateOne: {
          filter: {
            _id: claim._id,
            status: "payable",
            paidMinor: claim.paidMinor === undefined ? { $exists: false } : claim.paidMinor,
          },
          update: {
            $set: {
              paidMinor: payment.paidMinor,
              lastPaymentTurn: turn,
              status: payment.complete ? "paid" : "payable",
            },
          },
        },
      });
      if (!payment.paymentMinor) continue;
      const firmId = new ObjectId(claim.corporationId).toHexString();
      const firm = firmById.get(firmId)!;
      const code = resolveCorpLiquidCurrencyCode(firm);
      const rate = code ? rateByCode.get(code)! : 1;
      const localAmount = (payment.paymentMinor / 100) * rate;
      const nextCredit = (firmCredits.get(firmId) ?? 0) + localAmount;
      if (!Number.isFinite(nextCredit) || !Number.isFinite(firm.liquidCapital + nextCredit))
        throw new Error("Facility creditor cash exceeds precision");
      firmCredits.set(firmId, nextCredit);
      receipt.payments.push({
        claimId: claim.claimId,
        corporationId: claim.corporationId,
        paidMinor: payment.paymentMinor,
        currencyCode: code ?? null,
        rate,
        localAmount,
      });
    }
  }
  const firmWrites: AnyBulkWriteOperation<PaymentFirm>[] = [...firmCredits].map(([id, credit]) => ({
    updateOne: {
      filter: {
        _id: new ObjectId(id),
        countryId: firmById.get(id)!.countryId,
        liquidCapital: firmById.get(id)!.liquidCapital,
      },
      update: { $inc: { liquidCapital: credit } },
    },
  }));
  if (
    macroWrites.length &&
    (await db.collection<SuccessorCash>("macroCountries").bulkWrite(macroWrites, { session }))
      .matchedCount !== macroWrites.length
  )
    throw new Error("Successor cash changed during compensation");
  if (
    firmWrites.length &&
    (await db.collection<PaymentFirm>("corporations").bulkWrite(firmWrites, { session }))
      .matchedCount !== firmWrites.length
  )
    throw new Error("Creditor cash changed during compensation");
  if (
    claimWrites.length &&
    (await claimCollection.bulkWrite(claimWrites, { session })).matchedCount !== claimWrites.length
  )
    throw new Error("Facility claim changed during compensation");
  await receipts.insertOne(receipt, { session });
  return receipt;
}

export async function processFederationFacilityPaymentTurn(
  db: Db,
  turn: number,
  now: Date
): Promise<number> {
  const applications = await db
    .collection<FederationSettlementApplicationRecord>(
      FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION
    )
    .find(
      { presetId: "1991-default", status: "applied", appliedOnTurn: { $lt: turn } },
      { projection: { _id: 1 } }
    )
    .toArray();
  for (const application of applications)
    await runRequiredTransaction(
      (session) =>
        materializeFacilityPaymentTurn({ db, session, applicationId: application._id, turn, now }),
      { client: db.client }
    );
  return applications.length;
}

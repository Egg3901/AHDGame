import { createHash } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import type { BankSovereignClaim, FederalBudget } from "@/lib/db/types/budget";
import type { Bond } from "@/lib/db/types/bond";
import type { Corporation } from "@/lib/db/types/corporation";
import type { LedgerEntry } from "@/lib/ledger/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { BOND_UNIT_FACE_VALUE } from "@/lib/constants/bonds";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";
import { ensureFund } from "@/lib/banking/insurance";
import {
  resumeSettlement,
  settleTransition,
  type SettlementResult,
} from "@/lib/banking/settlementJournal";
import { settleAtomicDocumentTransition } from "@/lib/banking/atomicDocumentSettlement";
import { oid, type BankingTransition } from "@/lib/banking/rules/boundary";
import { sovereignClaimIncome } from "@/lib/banking/rules/sovereignCouponIncome";

/** Add a stable principal claim before the legacy holder payout loop can run. */
export async function addBankMaturityClaims(
  db: Db,
  input: {
    budgetId: string;
    countryId: string;
    currencyCode: CurrencyCode;
    turn: number;
    bond: Bond;
    anchorRate?: number;
    ledgerShadow?: boolean;
    treasuryCashLedgerEnabled?: boolean;
  }
): Promise<BankSovereignClaim[]> {
  const claims: BankSovereignClaim[] = [];
  const unitsByEpoch = new Map<
    string,
    { bankId: ObjectId; charteredTurn: number; units: number }
  >();
  for (const holder of input.bond.holders ?? []) {
    if (!holder.bankId || !Number.isSafeInteger(holder.charteredTurn)) continue;
    if (holder.bankTreasuryTradeId) continue;
    const key = `${holder.bankId.toHexString()}:${holder.charteredTurn}`;
    const existing = unitsByEpoch.get(key) ?? {
      bankId: holder.bankId,
      charteredTurn: holder.charteredTurn!,
      units: 0,
    };
    existing.units += Math.max(0, holder.units);
    unitsByEpoch.set(key, existing);
  }
  for (const holder of unitsByEpoch.values()) {
    const amountLocal = roundSavingsAmount(holder.units * BOND_UNIT_FACE_VALUE, input.currencyCode);
    if (amountLocal <= 0) continue;
    const claim: BankSovereignClaim = {
      id: `bank-sovereign-maturity:${input.bond._id.toHexString()}:${holder.bankId.toHexString()}:${holder.charteredTurn}`,
      kind: "maturity",
      bankId: holder.bankId.toHexString(),
      charteredTurn: holder.charteredTurn,
      bondId: input.bond._id.toHexString(),
      ...(input.treasuryCashLedgerEnabled === true ? { dueTurn: input.bond.maturityTurn } : {}),
      countryId: input.countryId,
      currencyCode: input.currencyCode,
      amountLocal,
      turn: input.turn,
      ledgerCreatedAt: new Date(),
      ...(input.anchorRate !== undefined ? { anchorRate: input.anchorRate } : {}),
      ...(input.ledgerShadow ? { ledgerShadow: true } : {}),
      ...(input.treasuryCashLedgerEnabled ? { treasuryCashLedgerEnabled: true } : {}),
    };
    // A paid bank leg belongs to the immutable due claim, not its funding turn.
    // BondTurn can replay in a later turn while non-bank holders still await
    // cash, so recover the terminal witness before deciding whether to push.
    const paidClaim =
      input.treasuryCashLedgerEnabled === true
        ? await db.collection<{ _id: string }>("bankMoneyMoves").findOne(
            {
              _id: { $regex: `^${claim.id}:(bank|insurance):` },
              status: "applied",
            },
            { projection: { _id: 1 } }
          )
        : await db
            .collection<{ _id: string; status: string }>("bankMoneyMoves")
            .findOne(
              { _id: `${claim.id}:funding:${input.turn}`, status: "applied" },
              { projection: { _id: 1 } }
            );
    const frozenPaid =
      input.treasuryCashLedgerEnabled === true &&
      input.bond.sovereignMaturityClaim?.paidBankClaimIds?.includes(claim.id);
    if (paidClaim || frozenPaid) {
      if (input.treasuryCashLedgerEnabled && paidClaim) await recordMaturityBankPayment(db, claim);
      continue;
    }
    const result = await db
      .collection<FederalBudget>("federalBudget")
      .updateOne(
        { _id: input.budgetId, "bankSovereignClaims.id": { $ne: claim.id } },
        { $push: { bankSovereignClaims: claim } }
      );
    if (result.matchedCount === 1) {
      claims.push(claim);
      continue;
    }
    const existing = await db
      .collection<FederalBudget>("federalBudget")
      .findOne(
        { _id: input.budgetId, "bankSovereignClaims.id": claim.id },
        { projection: { bankSovereignClaims: 1 } }
      );
    const saved = existing?.bankSovereignClaims?.find((row) => row.id === claim.id);
    if (
      !saved ||
      saved.amountLocal !== claim.amountLocal ||
      saved.charteredTurn !== claim.charteredTurn ||
      saved.treasuryCashLedgerEnabled !== claim.treasuryCashLedgerEnabled ||
      (saved.dueTurn !== undefined && saved.dueTurn !== claim.dueTurn)
    )
      throw new Error(`Bank maturity claim ${claim.id} changed after it was frozen`);
    claims.push(saved);
  }
  return claims;
}

async function recordMaturityBankPayment(db: Db, claim: BankSovereignClaim): Promise<void> {
  if (
    claim.kind !== "maturity" ||
    !claim.bondId ||
    !Number.isSafeInteger(claim.dueTurn) ||
    !ObjectId.isValid(claim.bondId)
  )
    return;
  const bondId = new ObjectId(claim.bondId);
  const quoteId = `sovereign-maturity:${claim.bondId}:${claim.dueTurn}`;
  const result = await db.collection<Bond>("bonds").updateOne(
    {
      _id: bondId,
      issuerType: "sovereign",
      maturityTurn: claim.dueTurn,
      "sovereignMaturityClaim.id": quoteId,
      "sovereignMaturityClaim.paidBankClaimIds": { $ne: claim.id },
    },
    { $push: { "sovereignMaturityClaim.paidBankClaimIds": claim.id } }
  );
  if (result.matchedCount === 0) {
    const bond = await db
      .collection<Bond>("bonds")
      .findOne({ _id: bondId }, { projection: { sovereignMaturityClaim: 1, matured: 1 } });
    if (!bond?.matured && bond?.sovereignMaturityClaim?.id !== quoteId)
      throw new Error(`Paid bank maturity claim ${claim.id} lost its due-turn quote`);
  }
}

type CorporationCharterState = Pick<Corporation, "_id" | "bankCharter" | "bankSovereignEscrows">;

function escrowPath(claim: BankSovereignClaim): string {
  return `bankSovereignEscrows.${claim.id}.amountLocal`;
}

function fundingTransition(
  claim: BankSovereignClaim,
  budgetId: string,
  attemptTurn: number
): BankingTransition {
  const key = `${claim.id}:funding:${attemptTurn}`;
  const cashLedger = claim.treasuryCashLedgerEnabled === true;
  const projections: BankingTransition["projections"] = [];
  if (cashLedger) {
    projections.push({
      collection: "federalBudget",
      filter: { _id: budgetId },
      update: { $inc: { treasuryBalance: -claim.amountLocal } },
      note: "Keep the signed fiscal-position record in step with the funded claim",
    });
    if (claim.ledgerShadow) {
      projections.push(fundingLedgerProjection(claim, key, attemptTurn, "government"));
      projections.push(fundingLedgerProjection(claim, key, attemptTurn, "government_cash"));
    }
  }
  return {
    key,
    kind: `sovereign_bank_${claim.kind}_escrow_funding`,
    turn: attemptTurn,
    currency: claim.currencyCode,
    legs: [
      {
        kind: "debit",
        amount: claim.amountLocal,
        collection: "federalBudget",
        filter: cashLedger
          ? { _id: budgetId, treasuryCashLocal: { $gte: claim.amountLocal } }
          : { _id: budgetId, treasuryBalance: { $gte: claim.amountLocal } },
        path: cashLedger ? "treasuryCashLocal" : "treasuryBalance",
        note: `Fund sovereign ${claim.kind} claim from treasury cash`,
      },
      {
        kind: "credit",
        amount: claim.amountLocal,
        collection: "corporations",
        filter: { _id: oid(claim.bankId) },
        path: escrowPath(claim),
        note: `Hold funded sovereign ${claim.kind} claim outside the replaceable charter`,
      },
    ],
    projections,
    event: {
      kind: "monetary.executed",
      command: `turn.sovereignBank.${claim.kind}.fundEscrow`,
      subjectType: "bank",
      subjectId: claim.bankId,
      amount: claim.amountLocal,
      meta: { claimKind: claim.kind, bondId: claim.bondId ?? "aggregate" },
    },
  };
}

function orphanInsuranceTransition(
  claim: BankSovereignClaim,
  budgetId: string,
  attemptTurn: number
): BankingTransition {
  const key = `${claim.id}:orphan-insurance:${attemptTurn}`;
  const cashLedger = claim.treasuryCashLedgerEnabled === true;
  return {
    key,
    kind: `sovereign_bank_${claim.kind}_orphan_insurance`,
    turn: attemptTurn,
    currency: claim.currencyCode,
    legs: [
      {
        kind: "debit",
        amount: claim.amountLocal,
        collection: "federalBudget",
        filter: cashLedger
          ? { _id: budgetId, treasuryCashLocal: { $gte: claim.amountLocal } }
          : { _id: budgetId, treasuryBalance: { $gte: claim.amountLocal } },
        path: cashLedger ? "treasuryCashLocal" : "treasuryBalance",
        note: "Fund the orphaned bank sovereign claim from spendable Treasury cash",
      },
      {
        kind: "credit",
        amount: claim.amountLocal,
        collection: "depositInsuranceFunds",
        filter: { _id: claim.currencyCode },
        path: "balance",
        note: "Pay the frozen old-epoch bank claim to deposit insurance",
      },
    ],
    projections: [
      ...(cashLedger
        ? [
            {
              collection: "federalBudget",
              filter: { _id: budgetId },
              update: { $inc: { treasuryBalance: -claim.amountLocal } },
              note: "Keep signed fiscal position aligned with funded claim payment",
            },
          ]
        : []),
      {
        collection: "federalBudget",
        filter: { _id: budgetId, "bankSovereignClaims.id": claim.id },
        update: { $pull: { bankSovereignClaims: { id: claim.id } } },
        note: "Clear the frozen claim after insurance receives its funded payout",
      },
    ],
    event: {
      kind: "monetary.executed",
      command: `turn.sovereignBank.${claim.kind}.orphanInsurance`,
      subjectType: "bank",
      subjectId: claim.bankId,
      amount: claim.amountLocal,
      meta: { claimKind: claim.kind, bondId: claim.bondId ?? "aggregate" },
    },
  };
}

function fundingLedgerProjection(
  claim: BankSovereignClaim,
  key: string,
  turn: number,
  account: "government" | "government_cash"
): BankingTransition["projections"][number] {
  if (!claim.anchorRate || !Number.isFinite(claim.anchorRate) || claim.anchorRate <= 0)
    throw new Error(`Bank sovereign claim ${claim.id} has no ledger valuation`);
  const anchorAmount = claim.amountLocal / claim.anchorRate;
  const ledgerId = new ObjectId(
    createHash("sha256").update(`${key}:funding-ledger:${account}`).digest("hex").slice(0, 24)
  );
  return {
    collection: "ledgerEntries",
    insert: {
      _id: ledgerId,
      turn,
      createdAt: claim.ledgerCreatedAt ?? new Date(Date.UTC(1970, 0, 1) + claim.turn * 1000),
      txType: claim.kind === "coupon" ? "gov_coupon_payment" : "gov_bond_maturity_payment",
      legs: [
        {
          account: `${account}:${claim.countryId}:${claim.currencyCode}`,
          amount: -claim.amountLocal,
          currencyCode: claim.currencyCode,
          anchorAmount: -anchorAmount,
          role: "primary",
        },
        {
          account: `sink:bank_sovereign_claim_funded:${claim.currencyCode}`,
          amount: claim.amountLocal,
          currencyCode: claim.currencyCode,
          anchorAmount,
          role: "contra",
        },
      ],
      balanced: true,
      emitSite: "banking/bankSovereignClaims:funding",
    },
    note: `Funded sovereign claim ${account} stock-flow witness`,
  };
}

function insuranceTransition(
  claim: BankSovereignClaim,
  budgetId: string,
  attemptTurn: number
): BankingTransition {
  const key = `${claim.id}:insurance:${attemptTurn}`;
  const projections: BankingTransition["projections"] = [
    {
      collection: "federalBudget",
      filter: { _id: budgetId },
      update: { $pull: { bankSovereignClaims: { id: claim.id } } },
      note: "Clear the funded sovereign claim after insurance receives escrow cash",
    },
  ];
  if (claim.ledgerShadow && !claim.treasuryCashLedgerEnabled)
    projections.push(ledgerProjection(claim, key, attemptTurn, "insurance"));
  return {
    key,
    kind: `sovereign_bank_${claim.kind}_insurance`,
    turn: attemptTurn,
    currency: claim.currencyCode,
    legs: [
      {
        kind: "debit",
        amount: claim.amountLocal,
        collection: "corporations",
        filter: {
          _id: oid(claim.bankId),
          [escrowPath(claim)]: { $gte: claim.amountLocal },
        },
        path: escrowPath(claim),
        note: `Release funded sovereign ${claim.kind} escrow to insurance`,
      },
      {
        kind: "credit",
        amount: claim.amountLocal,
        collection: "depositInsuranceFunds",
        filter: { _id: claim.currencyCode },
        path: "balance",
        note: `Route closed-epoch sovereign ${claim.kind} cash to insurance`,
      },
    ],
    projections,
    event: {
      kind: "monetary.executed",
      command: `turn.sovereignBank.${claim.kind}.insurance`,
      subjectType: "bank",
      subjectId: claim.bankId,
      amount: claim.amountLocal,
      meta: { claimKind: claim.kind, bondId: claim.bondId ?? "aggregate" },
    },
  };
}

function ledgerProjection(
  claim: BankSovereignClaim,
  key: string,
  turn: number,
  destination: "bank" | "insurance" = "bank"
): { collection: "ledgerEntries"; insert: LedgerEntry & Record<string, unknown>; note: string } {
  if (!claim.anchorRate || !Number.isFinite(claim.anchorRate) || claim.anchorRate <= 0)
    throw new Error(`Bank sovereign claim ${claim.id} has no ledger valuation`);
  const anchorAmount = claim.amountLocal / claim.anchorRate;
  const ledgerId = new ObjectId(
    createHash("sha256").update(`${key}:ledger`).digest("hex").slice(0, 24)
  );
  return {
    collection: "ledgerEntries",
    insert: {
      _id: ledgerId,
      turn,
      createdAt: claim.ledgerCreatedAt ?? new Date(Date.UTC(1970, 0, 1) + claim.turn * 1000),
      txType: claim.kind === "coupon" ? "gov_coupon_payment" : "gov_bond_maturity_payment",
      legs: [
        {
          account: `government:${claim.countryId}:${claim.currencyCode}`,
          amount: -claim.amountLocal,
          currencyCode: claim.currencyCode,
          anchorAmount: -anchorAmount,
          role: "primary",
        },
        {
          account:
            destination === "bank"
              ? `bank_vault:${claim.bankId}:${claim.currencyCode}`
              : `deposit_insurance:${claim.currencyCode}`,
          amount: claim.amountLocal,
          currencyCode: claim.currencyCode,
          anchorAmount,
          role: "contra",
        },
      ],
      balanced: true,
      emitSite: "banking/bankSovereignClaims",
    },
    note: "Exact funded sovereign claim transfer ledger witness",
  };
}

async function ensureLedgerWitness(
  db: Db,
  claim: BankSovereignClaim,
  key: string,
  turn: number,
  destination: "bank" | "insurance"
): Promise<void> {
  const expected = ledgerProjection(claim, key, turn, destination).insert;
  if (!(expected._id instanceof ObjectId)) throw new Error("Ledger witness id must be an ObjectId");
  const rows = db.collection<LedgerEntry>("ledgerEntries");
  await rows.updateOne({ _id: expected._id }, { $setOnInsert: expected }, { upsert: true });
  const stored = await rows.findOne({ _id: expected._id });
  const economicIdentity = (row: LedgerEntry) => ({
    turn: row.turn,
    createdAt: row.createdAt,
    txType: row.txType,
    legs: row.legs,
    balanced: row.balanced,
    emitSite: row.emitSite,
  });
  if (
    !stored ||
    JSON.stringify(economicIdentity(stored)) !== JSON.stringify(economicIdentity(expected))
  ) {
    throw new Error(`Bank sovereign ledger witness ${claim.id} conflicts with its receipt`);
  }
}

function bankPayoutTransition(claim: BankSovereignClaim, attemptTurn: number): BankingTransition {
  const key = `${claim.id}:bank:${attemptTurn}`;
  const couponIncome = sovereignClaimIncome(claim.kind, claim.amountLocal);
  const projection: BankingTransition["projections"][number] = {
    collection: "corporations",
    filter: { _id: oid(claim.bankId) },
    update: {
      $inc: {
        [escrowPath(claim)]: -claim.amountLocal,
        "bankCharter.cashReserves": claim.amountLocal,
        // Only a funded coupon is earnings. It rides the same atomic write as
        // the cash so a crash or replay can never split income from the vault.
        ...(couponIncome > 0 ? { "bankCharter.sovereignCouponIncomeTotal": couponIncome } : {}),
      },
    },
    note: `Atomically release funded sovereign ${claim.kind} cash to the matching charter epoch`,
  };
  return {
    key,
    kind: `sovereign_bank_${claim.kind}_vault`,
    turn: attemptTurn,
    currency: claim.currencyCode,
    legs: [
      {
        kind: "debit",
        amount: claim.amountLocal,
        collection: "corporations",
        filter: { _id: oid(claim.bankId) },
        path: escrowPath(claim),
        note: `Debit funded sovereign ${claim.kind} escrow`,
      },
      {
        kind: "credit",
        amount: claim.amountLocal,
        collection: "corporations",
        filter: { _id: oid(claim.bankId) },
        path: "bankCharter.cashReserves",
        note: `Credit matching epoch bank vault for sovereign ${claim.kind}`,
      },
    ],
    projections: [projection],
    event: {
      kind: "monetary.executed",
      command: `turn.sovereignBank.${claim.kind}.vault`,
      subjectType: "bank",
      subjectId: claim.bankId,
      amount: claim.amountLocal,
      meta: { claimKind: claim.kind, bondId: claim.bondId ?? "aggregate" },
    },
  };
}

async function fundClaimEscrow(
  db: Db,
  claim: BankSovereignClaim,
  budgetId: string,
  attemptTurn: number
): Promise<boolean> {
  const corps = db.collection<CorporationCharterState>("corporations");
  await corps.updateOne(
    {
      _id: new ObjectId(claim.bankId),
      [`bankSovereignEscrows.${claim.id}`]: { $exists: false },
    },
    {
      $set: {
        [`bankSovereignEscrows.${claim.id}`]: {
          bankId: claim.bankId,
          charteredTurn: claim.charteredTurn,
          currencyCode: claim.currencyCode,
          amountLocal: 0,
          claimKind: claim.kind,
        },
      },
    }
  );
  const pending = await db
    .collection<{ _id: string }>("bankMoneyMoves")
    .find({
      _id: { $regex: `^${claim.id}:funding:` },
      status: "partial",
    })
    .toArray();
  for (const row of pending) {
    const resumed = await resumeSettlement(db, row._id);
    if (resumed.status !== "applied" && (resumed.status !== "replayed" || resumed.error)) {
      // A prior treasury debit may already have landed. Never open a new
      // attempt while that receipt still owns an unfinished credit leg.
      return false;
    }
  }
  const unresolved = await db.collection<{ _id: string }>("bankMoneyMoves").findOne({
    _id: { $regex: `^${claim.id}:funding:` },
    status: "partial",
  });
  if (unresolved) return false;

  let corporation = await corps.findOne(
    { _id: new ObjectId(claim.bankId) },
    { projection: { bankSovereignEscrows: 1 } }
  );
  let escrowAmount = corporation?.bankSovereignEscrows?.[claim.id]?.amountLocal ?? 0;
  if (escrowAmount >= claim.amountLocal) return true;
  if (!corporation) return false;

  const transition = fundingTransition(claim, budgetId, attemptTurn);
  let settled = await settleTransition(db, transition);
  if (settled.status === "partial" || (settled.status === "replayed" && settled.error))
    settled = await resumeSettlement(db, transition.key);
  corporation = await corps.findOne(
    { _id: new ObjectId(claim.bankId) },
    { projection: { bankSovereignEscrows: 1 } }
  );
  escrowAmount = corporation?.bankSovereignEscrows?.[claim.id]?.amountLocal ?? 0;
  return escrowAmount >= claim.amountLocal;
}

async function payFromEscrow(
  db: Db,
  claim: BankSovereignClaim,
  budgetId: string,
  attemptTurn: number,
  charter: CorporationCharterState["bankCharter"]
): Promise<SettlementResult | null> {
  const exactEpoch =
    charter?.currency === claim.currencyCode && charter.charteredTurn === claim.charteredTurn;
  const closedEstate =
    !exactEpoch ||
    (charter?.status === "failed" && charter.depositorsResolvedTurn != null) ||
    charter?.status === "revoked";
  if (exactEpoch && charter?.status === "active") {
    const transition = bankPayoutTransition(claim, attemptTurn);
    let settled = await settleAtomicDocumentTransition(db, transition, {
      identity: { _id: oid(claim.bankId) },
      guard: {
        "bankCharter.currency": claim.currencyCode,
        "bankCharter.charteredTurn": claim.charteredTurn,
        "bankCharter.status": "active",
      },
    });
    if (settled.status === "partial" || (settled.status === "replayed" && settled.error))
      settled = await resumeSettlement(db, transition.key);
    if (settled.status === "applied" || (settled.status === "replayed" && !settled.error)) {
      if (claim.ledgerShadow && !claim.treasuryCashLedgerEnabled) {
        await ensureLedgerWitness(db, claim, transition.key, attemptTurn, "bank");
      }
      await db
        .collection<FederalBudget>("federalBudget")
        .updateOne({ _id: budgetId }, { $pull: { bankSovereignClaims: { id: claim.id } } });
      return settled;
    }
    if (settled.status !== "rejected") return settled;
    const current = await db
      .collection<CorporationCharterState>("corporations")
      .findOne({ _id: new ObjectId(claim.bankId) }, { projection: { bankCharter: 1 } });
    const stillExactActive =
      current?.bankCharter?.currency === claim.currencyCode &&
      current.bankCharter.charteredTurn === claim.charteredTurn &&
      current.bankCharter.status === "active";
    if (stillExactActive) return settled;
  } else if (!closedEstate) {
    return null;
  }

  // The active epoch guard refused atomically, so its escrow leg did not move.
  // A stale epoch transfers the same funded balance to insurance instead.
  await ensureFund(db, claim.currencyCode);
  const transition = insuranceTransition(claim, budgetId, attemptTurn);
  let insured = await settleTransition(db, transition);
  if (insured.status === "partial" || (insured.status === "replayed" && insured.error))
    insured = await resumeSettlement(db, transition.key);
  return insured;
}

async function recoverCompletedClaim(
  db: Db,
  claim: BankSovereignClaim,
  budgetId: string
): Promise<boolean> {
  const records = await db
    .collection<{ _id: string; kind?: string; turn?: number; status?: string }>("bankMoneyMoves")
    .find({ _id: { $regex: `^${claim.id}:(bank|insurance|orphan-insurance):` } })
    .toArray();
  for (const record of records) {
    if (record.status !== "partial" && record.status !== "applied") continue;
    const settled = await resumeSettlement(db, record._id);
    if (settled.status !== "applied" && (settled.status !== "replayed" || settled.error)) continue;
    if (record._id.includes(":bank:") && claim.ledgerShadow && !claim.treasuryCashLedgerEnabled) {
      await ensureLedgerWitness(db, claim, record._id, record.turn ?? claim.turn, "bank");
    } else if (
      record._id.includes(":insurance:") &&
      claim.ledgerShadow &&
      !claim.treasuryCashLedgerEnabled
    ) {
      await ensureLedgerWitness(db, claim, record._id, record.turn ?? claim.turn, "insurance");
    }
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id: budgetId }, { $pull: { bankSovereignClaims: { id: claim.id } } });
    return true;
  }
  return false;
}

/** Fund due claims once, then release from epoch-scoped escrow or to insurance. */
export async function settleBankSovereignClaims(
  db: Db,
  budget: Pick<FederalBudget, "_id" | "countryId" | "bankSovereignClaims">,
  attemptTurn: number
): Promise<{ paidClaimIds: string[] }> {
  const claims = [...(budget.bankSovereignClaims ?? [])].sort(
    (a, b) => a.turn - b.turn || a.id.localeCompare(b.id)
  );
  if (!claims.length) return { paidClaimIds: [] };
  const paidClaimIds: string[] = [];

  for (const claim of claims) {
    if (!ObjectId.isValid(claim.bankId)) continue;
    const budgetId = String(budget._id);
    if (await recoverCompletedClaim(db, claim, budgetId)) {
      if (claim.treasuryCashLedgerEnabled) await recordMaturityBankPayment(db, claim);
      paidClaimIds.push(claim.id);
      continue;
    }
    const unfinishedPayout = await db.collection<{ _id: string }>("bankMoneyMoves").findOne({
      _id: { $regex: `^${claim.id}:(bank|insurance|orphan-insurance):` },
      status: "partial",
    });
    if (unfinishedPayout) continue;
    const corporation = await db
      .collection<CorporationCharterState>("corporations")
      .findOne({ _id: new ObjectId(claim.bankId) }, { projection: { _id: 1 } });
    if (!corporation) {
      await ensureFund(db, claim.currencyCode);
      const orphaned = await settleTransition(
        db,
        orphanInsuranceTransition(claim, budgetId, attemptTurn)
      );
      if (orphaned.status === "applied" || (orphaned.status === "replayed" && !orphaned.error)) {
        if (claim.treasuryCashLedgerEnabled) await recordMaturityBankPayment(db, claim);
        paidClaimIds.push(claim.id);
      }
      continue;
    }
    if (!(await fundClaimEscrow(db, claim, budgetId, attemptTurn))) continue;
    const corp = await db
      .collection<CorporationCharterState>("corporations")
      .findOne(
        { _id: new ObjectId(claim.bankId) },
        { projection: { bankCharter: 1, bankSovereignEscrows: 1 } }
      );
    const settled = await payFromEscrow(db, claim, budgetId, attemptTurn, corp?.bankCharter);
    if (settled?.status === "applied" || (settled?.status === "replayed" && !settled.error)) {
      if (claim.treasuryCashLedgerEnabled) await recordMaturityBankPayment(db, claim);
      paidClaimIds.push(claim.id);
    }
  }
  return { paidClaimIds };
}

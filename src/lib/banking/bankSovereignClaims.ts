import { createHash } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import type { BankSovereignClaim, FederalBudget } from "@/lib/db/types/budget";
import type { Bond } from "@/lib/db/types/bond";
import type { Corporation } from "@/lib/db/types/corporation";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import {
  BOND_UNIT_FACE_VALUE,
  bondAccruesCoupon,
  perTurnCouponPayment,
} from "@/lib/constants/bonds";
import { ensureFund } from "@/lib/banking/insurance";
import {
  resumeSettlement,
  settleTransition,
  type SettlementResult,
} from "@/lib/banking/settlementJournal";
import { settleAtomicDocumentTransition } from "@/lib/banking/atomicDocumentSettlement";
import { oid, type BankingTransition } from "@/lib/banking/rules/boundary";

export interface BankCouponPlan {
  bankId: string;
  charteredTurn: number;
  amountLocal: number;
  bondIds: string[];
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Freeze the eligible bank coupon slice from the opening sovereign bond snapshot. */
export function bankCouponPlanForCountry(
  bonds: readonly Bond[],
  countryId: string,
  currencyCode: CurrencyCode
): BankCouponPlan[] {
  const byEpoch = new Map<string, BankCouponPlan>();
  for (const bond of bonds) {
    if (bond.issuerType !== "sovereign" || bond.countryId !== countryId || !bondAccruesCoupon(bond))
      continue;
    const bondCurrency =
      bond.currencyCode ??
      COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP];
    for (const holder of bond.holders ?? []) {
      if (!holder.bankId) continue;
      if (!Number.isSafeInteger(holder.charteredTurn) || (holder.charteredTurn ?? 0) < 0) continue;
      if (bondCurrency !== currencyCode) continue;
      const bankId = holder.bankId.toHexString();
      const charteredTurn = holder.charteredTurn!;
      const key = `${bankId}:${charteredTurn}`;
      const plan = byEpoch.get(key) ?? {
        bankId,
        charteredTurn,
        amountLocal: 0,
        bondIds: [],
      };
      plan.amountLocal +=
        perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE) * holder.units;
      plan.bondIds.push(bond._id.toHexString());
      byEpoch.set(key, plan);
    }
  }
  return [...byEpoch.values()]
    .map((plan) => ({
      ...plan,
      amountLocal: roundCurrency(plan.amountLocal),
      bondIds: [...new Set(plan.bondIds)].sort(),
    }))
    .filter((plan) => plan.amountLocal > 0)
    .sort((a, b) => a.bankId.localeCompare(b.bankId) || a.charteredTurn - b.charteredTurn);
}

export function bankCouponClaim(input: {
  countryId: string;
  currencyCode: CurrencyCode;
  turn: number;
  plan: BankCouponPlan;
  anchorRate?: number;
  ledgerShadow?: boolean;
}): BankSovereignClaim {
  const { countryId, currencyCode, turn, plan } = input;
  return {
    id: `bank-sovereign-coupon:${countryId}:${turn}:${plan.bankId}:${plan.charteredTurn}`,
    kind: "coupon",
    bankId: plan.bankId,
    charteredTurn: plan.charteredTurn,
    countryId,
    currencyCode,
    amountLocal: plan.amountLocal,
    turn,
    bondIds: plan.bondIds,
    ...(input.anchorRate !== undefined ? { anchorRate: input.anchorRate } : {}),
    ...(input.ledgerShadow ? { ledgerShadow: true } : {}),
  };
}

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
  }
): Promise<BankSovereignClaim[]> {
  const claims: BankSovereignClaim[] = [];
  for (const holder of input.bond.holders ?? []) {
    if (!holder.bankId || !Number.isSafeInteger(holder.charteredTurn)) continue;
    const amountLocal = roundCurrency(holder.units * BOND_UNIT_FACE_VALUE);
    if (amountLocal <= 0) continue;
    const claim: BankSovereignClaim = {
      id: `bank-sovereign-maturity:${input.bond._id.toHexString()}:${holder.bankId.toHexString()}:${holder.charteredTurn}`,
      kind: "maturity",
      bankId: holder.bankId.toHexString(),
      charteredTurn: holder.charteredTurn!,
      bondId: input.bond._id.toHexString(),
      countryId: input.countryId,
      currencyCode: input.currencyCode,
      amountLocal,
      turn: input.turn,
      ...(input.anchorRate !== undefined ? { anchorRate: input.anchorRate } : {}),
      ...(input.ledgerShadow ? { ledgerShadow: true } : {}),
    };
    // BondTurn can replay after the settlement projection removed this claim.
    // Do not recreate it if the same-turn funding witness already completed.
    const settled = await db
      .collection("bankMoneyMoves")
      .findOne(
        { _id: `${claim.id}:funding:${input.turn}`, status: "applied" },
        { projection: { _id: 1 } }
      );
    if (settled) continue;
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
      saved.charteredTurn !== claim.charteredTurn
    )
      throw new Error(`Bank maturity claim ${claim.id} changed after it was frozen`);
    claims.push(saved);
  }
  return claims;
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
        filter: { _id: budgetId, treasuryBalance: { $gte: claim.amountLocal } },
        path: "treasuryBalance",
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
    projections: [],
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
  if (claim.ledgerShadow) projections.push(ledgerProjection(claim, key, attemptTurn, "insurance"));
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
): BankingTransition["projections"][number] {
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
      createdAt: new Date(),
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

function bankPayoutTransition(claim: BankSovereignClaim, attemptTurn: number): BankingTransition {
  const key = `${claim.id}:bank:${attemptTurn}`;
  const projection: BankingTransition["projections"][number] = {
    collection: "corporations",
    filter: { _id: oid(claim.bankId) },
    update: {
      $inc: {
        [escrowPath(claim)]: -claim.amountLocal,
        "bankCharter.cashReserves": claim.amountLocal,
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
  for (const row of pending) await resumeSettlement(db, row._id);

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
      if (claim.ledgerShadow) {
        const ledger = ledgerProjection(claim, transition.key, attemptTurn).insert!;
        const rows = db.collection("ledgerEntries");
        await rows.updateOne({ _id: ledger._id }, { $setOnInsert: ledger }, { upsert: true });
        const stored = await rows.findOne({ _id: ledger._id });
        if (!stored || JSON.stringify(stored) !== JSON.stringify(ledger))
          throw new Error(`Bank sovereign ledger witness ${claim.id} conflicts with its receipt`);
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
    .find({ _id: { $regex: `^${claim.id}:(bank|insurance):` } })
    .toArray();
  for (const record of records) {
    if (record.status !== "partial" && record.status !== "applied") continue;
    const settled = await resumeSettlement(db, record._id);
    if (settled.status !== "applied" && (settled.status !== "replayed" || settled.error)) continue;
    if (record._id.includes(":bank:") && claim.ledgerShadow) {
      const ledger = ledgerProjection(claim, record._id, record.turn ?? claim.turn).insert!;
      const rows = db.collection("ledgerEntries");
      await rows.updateOne({ _id: ledger._id }, { $setOnInsert: ledger }, { upsert: true });
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
      paidClaimIds.push(claim.id);
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
      paidClaimIds.push(claim.id);
    }
  }
  return { paidClaimIds };
}

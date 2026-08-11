import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { getControllingCorporateParent } from "@/lib/corporations/corporateOwnership";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import {
  atomicallyDebitCorpLiquidCapital,
  creditCorpLiquidCapital,
  refundCorpLiquidCapital,
} from "@/lib/financialTxLog/atomicCashGuard";
import { emitTx } from "@/lib/financialTxLog/emit";
import { recordAudit } from "@/lib/audit/recordAudit";
import { canActOnCorporationAsParent } from "../authorization";
import {
  SUBSIDIARY_CAPITAL_INJECTION_COOLDOWN_TURNS,
  SUBSIDIARY_CAPITAL_INJECTION_MAX_PCT_OF_PARENT_LIQUID,
} from "../constants";
import { fail, type SubsidiaryCommandResult } from "../commandTypes";

export interface CapitalInjectionInput {
  sub: Corporation;
  callerUserId: ObjectId;
  /** Amount in the PARENT's local (liquidCurrencyCode) units. */
  amount: number;
  turn: number;
  now: Date;
}

/**
 * Parent injects capital into the subsidiary. Forex-aware (parent local → ₳ →
 * subsidiary local); atomic debit on the parent, credit on the subsidiary.
 * One injection ≤ 25% of parent liquid capital; 24-turn per-subsidiary cooldown.
 */
export async function capitalInjection(
  db: Db,
  input: CapitalInjectionInput
): Promise<SubsidiaryCommandResult<{ debitedParent: number; creditedSubsidiary: number }>> {
  const { sub, callerUserId, amount, turn, now } = input;

  if (!(await canActOnCorporationAsParent(db, callerUserId, sub))) {
    return fail("You are not authorized to manage this subsidiary.", 403);
  }

  if (!Number.isFinite(amount) || amount <= 0) return fail("Injection amount must be positive.");

  const controllingParent = getControllingCorporateParent(sub);
  if (!controllingParent) return fail("This corporation is no longer a subsidiary.", 409);
  const parent = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: controllingParent.corporationId });
  if (!parent) return fail("Parent corporation not found.", 404);

  // Per-subsidiary cooldown.
  if (
    sub.lastCapitalInjectionTurn != null &&
    turn - sub.lastCapitalInjectionTurn < SUBSIDIARY_CAPITAL_INJECTION_COOLDOWN_TURNS
  ) {
    const remaining =
      SUBSIDIARY_CAPITAL_INJECTION_COOLDOWN_TURNS - (turn - sub.lastCapitalInjectionTurn);
    return fail(`Capital injection is on cooldown for ${remaining} more turn(s).`);
  }

  // Cap at 25% of parent liquid capital (parent local units).
  const maxInjection = Math.floor(
    (parent.liquidCapital ?? 0) * SUBSIDIARY_CAPITAL_INJECTION_MAX_PCT_OF_PARENT_LIQUID
  );
  const amountLocal = Math.round(amount);
  if (amountLocal > maxInjection) {
    return fail(
      `A single injection cannot exceed 25% of parent liquid capital (max ${maxInjection.toLocaleString()} ${
        resolveCorpLiquidCurrencyCode(parent) ?? "USD"
      }).`
    );
  }

  // Forex conversion: parent local → ₳ → subsidiary local.
  const [parentFx, subFx] = await Promise.all([getCorpFxRate(db, parent), getCorpFxRate(db, sub)]);
  const amountAnchor = corpLiquidCapitalToAnchor(amountLocal, parent, parentFx);
  const amountInSubLocal = Math.round(anchorToCorpLiquidCapital(amountAnchor, sub, subFx));
  if (!Number.isFinite(amountInSubLocal) || amountInSubLocal <= 0) {
    return fail("Injection amount is too small after currency conversion.");
  }

  // Atomic debit on the parent (race-safe balance gate).
  const debit = await atomicallyDebitCorpLiquidCapital(db, parent._id, amountLocal);
  if (!debit.ok) {
    return fail("Insufficient parent corporate funds.");
  }

  try {
    const creditedBalance = await creditCorpLiquidCapital(db, sub._id, amountInSubLocal);
    if (creditedBalance === null) {
      await refundCorpLiquidCapital(db, parent._id, amountLocal);
      return fail("Subsidiary corporation not found.", 404);
    }
  } catch (err) {
    await refundCorpLiquidCapital(db, parent._id, amountLocal);
    throw err;
  }

  await db
    .collection<Corporation>("corporations")
    .updateOne({ _id: sub._id }, { $set: { lastCapitalInjectionTurn: turn, updatedAt: now } });

  const parentCurrency = resolveCorpLiquidCurrencyCode(parent) ?? "USD";
  const subCurrency = resolveCorpLiquidCurrencyCode(sub) ?? "USD";
  await Promise.all([
    emitTx(db, {
      type: "corp_capital_injection",
      turn,
      createdAt: now,
      subjectType: "corporation",
      subjectId: parent._id,
      subjectName: parent.name,
      amount: -amountLocal,
      balanceAfter: debit.newBalance,
      currencyCode: parentCurrency,
      counterpartyType: "corporation",
      counterpartyId: sub._id,
      counterpartyName: sub.name,
      meta: { kind: "parent_capital_injection", subsidiaryId: sub._id.toString() },
    }),
    emitTx(db, {
      type: "corp_capital_injection",
      turn,
      createdAt: now,
      subjectType: "corporation",
      subjectId: sub._id,
      subjectName: sub.name,
      amount: amountInSubLocal,
      currencyCode: subCurrency,
      counterpartyType: "corporation",
      counterpartyId: parent._id,
      counterpartyName: parent.name,
      meta: { kind: "subsidiary_capital_received", parentId: parent._id.toString() },
    }),
  ]);

  recordAudit({
    source: "api",
    action: "corp.capitalInjection",
    category: "corp",
    turn,
    ts: now,
    actor: { kind: "player", userId: callerUserId },
    subject: { type: "corporation", id: parent._id, name: parent.name },
    counterparty: { type: "corporation", id: sub._id, name: sub.name },
    amount: -amountLocal,
    currencyCode: parentCurrency,
    refs: { corporationId: parent._id },
    outcome: "ok",
    meta: { subsidiaryId: sub._id, creditedSubsidiary: amountInSubLocal, subCurrency },
  });

  return { ok: true, debitedParent: amountLocal, creditedSubsidiary: amountInSubLocal };
}

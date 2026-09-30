/**
 * Commit funded sovereign placements and their accounting witnesses through
 * the existing settlement journal. Partial settlements stay visible to its
 * recovery worker; callers never reconstruct a second cash move after a crash.
 */
import { createHash } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { TransitionProjection } from "@/lib/banking/rules/boundary";
import { computeExpiresAtSync } from "@/lib/financialTxLog/expiresAt";
import { DEFAULT_TURN_LENGTH_MINUTES } from "@/lib/db/types/financialTxLog";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import { settleTransition } from "@/lib/banking/settlementJournal";
import { sovereignPrimaryTransition, type SovereignPrimaryFunding } from "./rules/sovereignPrimary";

export interface PrimaryAccountingContext {
  ledgerShadow: boolean;
  turnLengthMinutes: number;
  rates: Map<string, number>;
}

export async function loadPrimaryAccounting(db: Db): Promise<PrimaryAccountingContext> {
  const [config, rates] = await Promise.all([
    db
      .collection<{ _id: string; ledgerShadow?: boolean; turnLengthMinutes?: number }>("gameConfig")
      .findOne({ _id: "default" }, { projection: { ledgerShadow: 1, turnLengthMinutes: 1 } }),
    db
      .collection<{ currencyCode: string; rate: number }>("exchangeRates")
      .find({}, { projection: { currencyCode: 1, rate: 1 } })
      .toArray(),
  ]);
  return {
    ledgerShadow: config?.ledgerShadow === true,
    turnLengthMinutes: config?.turnLengthMinutes ?? DEFAULT_TURN_LENGTH_MINUTES,
    rates: new Map(rates.map((r) => [r.currencyCode, r.rate])),
  };
}

export function primaryDocumentId(key: string): ObjectId {
  return new ObjectId(createHash("sha256").update(key).digest("hex").slice(0, 24));
}

/** A recorded intent wins over any freshly recomputed quote. */
export async function primarySettlementExists(db: Db, key: string): Promise<boolean> {
  const record = await db
    .collection<{ _id: string; status: string; projectionsCompletedAt?: Date }>(
      MONEY_MOVE_COLLECTION
    )
    .findOne({ _id: key }, { projection: { status: 1, projectionsCompletedAt: 1 } });
  if (!record) return false;
  if (record.status !== "applied" || !record.projectionsCompletedAt) {
    throw new Error(`Sovereign placement ${key} awaits settlement recovery`);
  }
  return true;
}

export async function commitSovereignPrimary(
  db: Db,
  input: SovereignPrimaryFunding & { countryId: string; now: Date },
  projections: TransitionProjection[],
  accounting: PrimaryAccountingContext
): Promise<void> {
  const transition = sovereignPrimaryTransition(input);
  transition.projections.push(...projections);
  const observedRate = accounting.rates.get(input.currency) ?? 1;
  const rate = Number.isFinite(observedRate) && observedRate > 0 ? observedRate : 1;
  if (input.poolCash + input.monetaryCash > 0) {
    transition.projections.push({
      collection: "financialTxLog",
      note: "Durable issuer cash receipt",
      insert: {
        _id: primaryDocumentId(`${input.key}:receipt`),
        type: "gov_bond_issuance",
        turn: input.turn,
        createdAt: input.now,
        expiresAt: computeExpiresAtSync(input.now, accounting.turnLengthMinutes),
        subjectType: "government",
        countryId: input.countryId,
        subjectName: `${input.countryId} Government`,
        amount: input.poolCash + input.monetaryCash,
        currencyCode: input.currency,
        anchorAmount: (input.poolCash + input.monetaryCash) / rate,
        meta: {
          settlementKey: input.key,
          poolCash: input.poolCash,
          monetaryCash: input.monetaryCash,
          face: input.face,
        },
        flagged: false,
      },
    });
  }
  if (accounting.ledgerShadow && input.poolCash + input.monetaryCash > 0) {
    const currency = input.currency as CurrencyCode;
    const legs = [
      {
        account: `government:${input.countryId}:${currency}`,
        amount: input.poolCash + input.monetaryCash,
        currencyCode: currency,
        anchorAmount: (input.poolCash + input.monetaryCash) / rate,
        role: "primary",
      },
    ];
    if (input.poolCash > 0)
      legs.push({
        account: `bond_pool:${currency}:${currency}`,
        amount: -input.poolCash,
        currencyCode: currency,
        anchorAmount: -input.poolCash / rate,
        role: "primary",
      });
    if (input.monetaryCash > 0)
      legs.push({
        account: `mint:sovereign_primary:${currency}`,
        amount: -input.monetaryCash,
        currencyCode: currency,
        anchorAmount: -input.monetaryCash / rate,
        role: "contra",
      });
    transition.projections.push({
      collection: "ledgerEntries",
      note: "Primary financing stock-flow witness",
      insert: {
        _id: primaryDocumentId(`${input.key}:ledger`),
        turn: input.turn,
        createdAt: input.now,
        txType: "gov_bond_issuance",
        legs,
        balanced: true,
        emitSite: "bonds/sovereignPrimarySettlement",
      },
    });
  }
  const result = await settleTransition(db, transition);
  if (result.status === "partial" || result.status === "rejected" || result.error) {
    throw new Error(result.error ?? `Sovereign placement ${input.key} is incomplete`);
  }
}

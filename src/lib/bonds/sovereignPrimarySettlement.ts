/**
 * Commit funded sovereign placements and their accounting witnesses through
 * the existing settlement journal. Partial settlements stay visible to its
 * recovery worker; callers never reconstruct a second cash move after a crash.
 */
import { createHash } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import {
  COUNTRY_CURRENCY_MAP,
  FOREX_ACTIVE_COUNTRIES,
  eraRateForCurrency,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
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
  /** World preset, for the authored era rate of a currency with no exchangeRates row. */
  preset?: string;
}

/**
 * Rate for a sovereign primary placement. A live exchangeRates row wins. A
 * country outside the forex system issuing in its own currency (the
 * Warsaw-Pact currencies have no row by design) uses its authored era rate,
 * the same rule treasury accrual applies, instead of failing the bond turn.
 */
export function primaryFinancingRate(
  accounting: Pick<PrimaryAccountingContext, "rates" | "preset">,
  countryId: string,
  currency: string
): number | undefined {
  const observed = accounting.rates.get(currency);
  if (observed !== undefined) return observed;
  if (
    !FOREX_ACTIVE_COUNTRIES.includes(countryId as CountryId) &&
    COUNTRY_CURRENCY_MAP[countryId as CountryId] === currency
  ) {
    return eraRateForCurrency(currency as CurrencyCode, accounting.preset);
  }
  return undefined;
}

export async function loadPrimaryAccounting(db: Db): Promise<PrimaryAccountingContext> {
  const [config, rates, gameState] = await Promise.all([
    db
      .collection<{ _id: string; ledgerShadow?: boolean; turnLengthMinutes?: number }>("gameConfig")
      .findOne({ _id: "default" }, { projection: { ledgerShadow: 1, turnLengthMinutes: 1 } }),
    db
      .collection<{ currencyCode: string; rate: number }>("exchangeRates")
      .find({}, { projection: { currencyCode: 1, rate: 1 } })
      .toArray(),
    db
      .collection<{ _id: string; preset?: string }>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1 } }),
  ]);
  return {
    ledgerShadow: config?.ledgerShadow === true,
    turnLengthMinutes: config?.turnLengthMinutes ?? DEFAULT_TURN_LENGTH_MINUTES,
    rates: new Map(rates.map((r) => [r.currencyCode, r.rate])),
    preset: gameState?.preset ?? "",
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

/**
 * Which of `keys` already have a settlement record, in one read. Presence only:
 * a caller still runs `primarySettlementExists` on a present key for its
 * status check, so a record awaiting recovery throws exactly as before.
 */
export async function existingPrimarySettlementKeys(
  db: Db,
  keys: readonly string[]
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db
    .collection<{ _id: string }>(MONEY_MOVE_COLLECTION)
    .find({ _id: { $in: [...keys] } }, { projection: { _id: 1 } })
    .toArray();
  return new Set(rows.map((row) => String(row._id)));
}

export async function commitSovereignPrimary(
  db: Db,
  input: SovereignPrimaryFunding & { countryId: string; now: Date },
  projections: TransitionProjection[],
  accounting: PrimaryAccountingContext
): Promise<void> {
  const transition = sovereignPrimaryTransition(input);
  transition.projections.push(...projections);
  const observedRate = primaryFinancingRate(accounting, input.countryId, input.currency);
  if (
    input.poolCash + input.monetaryCash > 0 &&
    (observedRate === undefined || !Number.isFinite(observedRate) || observedRate <= 0)
  ) {
    throw new Error(`Missing valid primary-financing exchange rate for ${input.currency}`);
  }
  // Unfunded offers have no cash receipt or anchor witness to convert.
  const rate = observedRate ?? 1;
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
          ledgerOwnedBySettlement: true,
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

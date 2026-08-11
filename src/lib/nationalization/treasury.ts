import type { Db, ObjectId } from "mongodb";
import type { Corporation, FederalBudget } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { writeGovBudgetLocal } from "@/lib/currency/govBudgetFields";

/**
 * Government cash account for nationalization money flows.
 *
 * All "government money" — nationalization compensation, CEO treasury draws,
 * privatization proceeds, SOE remittance and loss-backing — moves the country's
 * signed `federalBudget.treasuryBalance` (the unified national cash position; see
 * the live-treasury-balance spec §5). The balance is allowed to go negative (the
 * country takes on debt); FX-intervention reserves live in a separate
 * `centralBanks.reserveBalance` field and are untouched here. Each flow keeps its
 * corp-side counterparty, so money is conserved — only the account changed.
 */

/** Move `delta` (signed, country-local currency) on the country's treasury balance. */
async function incTreasuryBalance(
  db: Db,
  countryId: CountryId,
  delta: number,
  now: Date
): Promise<void> {
  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne({ countryId }, { $inc: { treasuryBalance: delta }, $set: { updatedAt: now } });
}

/**
 * Debit `payoutAnchor` (₳) of nationalization compensation from the country's
 * treasury, converting to home currency at `fxByCurrency`. Returns the local
 * amount debited. The debit is unconditional — an unaffordable payout simply
 * pushes the treasury further into the hole (national debt) rather than being
 * blocked, consistent with the unified-treasury model. Seizure (0 payout) moves
 * nothing.
 */
export async function debitTreasuryCompensation(
  db: Db,
  countryId: CountryId,
  payoutAnchor: number,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>,
  now: Date
): Promise<number> {
  if (payoutAnchor <= 0) return 0;

  const currency = (COUNTRY_CURRENCY_MAP[countryId] ?? "USD") as CurrencyCode;
  const rate = fxByCurrency.get(currency) ?? 1;
  const payoutLocal = Math.round(writeGovBudgetLocal(payoutAnchor, currency, rate));

  await incTreasuryBalance(db, countryId, -payoutLocal, now);
  return payoutLocal;
}

/**
 * Credit divestiture proceeds (privatization IPO float sale, spec §13.2) to the
 * country's treasury, in home currency. `proceedsLocal` is already denominated in
 * the country's currency (the spun-out corp's sharePrice is local), so no FX
 * conversion is applied. Returns the local amount credited. Inverse of
 * {@link debitTreasuryCompensation}; symmetric double-entry with the share-float pool.
 */
export async function creditTreasuryProceeds(
  db: Db,
  countryId: CountryId,
  proceedsLocal: number,
  now: Date
): Promise<number> {
  if (proceedsLocal <= 0) return 0;
  const amount = Math.round(proceedsLocal);
  await incTreasuryBalance(db, countryId, amount, now);
  return amount;
}

/**
 * Cover an SOE operating-loss shortfall (spec §11.2 — SOEs cannot go bankrupt).
 * Unconditional debit of the treasury in home currency (the national budget's
 * cash account). `shortfallAnchor` is the positive ₳ amount needed to bring the
 * SOE's liquidCapital back to zero. Returns the local amount debited.
 */
export async function coverSoeOperatingLoss(
  db: Db,
  countryId: CountryId,
  shortfallAnchor: number,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>,
  now: Date
): Promise<number> {
  if (shortfallAnchor <= 0) return 0;
  const currency = (COUNTRY_CURRENCY_MAP[countryId] ?? "USD") as CurrencyCode;
  const rate = fxByCurrency.get(currency) ?? 1;
  const local = Math.round(writeGovBudgetLocal(shortfallAnchor, currency, rate));
  await incTreasuryBalance(db, countryId, -local, now);
  return local;
}

/**
 * Debit the owning treasury for a state capex grant — the budgeted line that
 * buys back one turn of depreciation on a state enterprise's capacity (plants
 * tier; see `applyStateCapexGrants`).
 *
 * Deliberately NOT `drawFromTreasury`: the money never becomes corp cash. The
 * state pays the builder and the enterprise receives PLANT, so the grant cannot
 * be diverted into a discretionary build order — which is what keeps the P3b
 * anti-exploit ("an SOE cannot have the treasury fund an unbounded build")
 * closed. Unconditional debit, exactly like {@link coverSoeOperatingLoss}: an
 * unaffordable grant pushes the treasury into debt rather than being refused.
 * Returns the local amount debited.
 */
export async function debitTreasurySoeCapex(
  db: Db,
  countryId: CountryId,
  grantAnchor: number,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>,
  now: Date
): Promise<number> {
  if (!(grantAnchor > 0)) return 0;
  const currency = (COUNTRY_CURRENCY_MAP[countryId] ?? "USD") as CurrencyCode;
  const rate = fxByCurrency.get(currency) ?? 1;
  const local = Math.round(writeGovBudgetLocal(grantAnchor, currency, rate));
  if (local <= 0) return 0;
  await incTreasuryBalance(db, countryId, -local, now);
  return local;
}

/**
 * CEO treasury draw (spec P6g §5.2): move `amountLocal` (already in the country's
 * currency — a NatCorp's liquidCapital is local) from the treasury into the
 * National Corporation's liquidCapital. The debit is unconditional — a draw is
 * permitted even when it pushes the treasury negative. The per-turn
 * `treasuryDrawCap` (set by the treasury minister; 0 disables draws entirely) is
 * the only hard limit, enforced by the route. Returns `{ ok: true, amount }`.
 */
export async function drawFromTreasury(
  db: Db,
  input: { countryId: CountryId; corpId: ObjectId; amountLocal: number },
  now: Date
): Promise<{ ok: true; amount: number }> {
  const amount = Math.round(input.amountLocal);
  if (amount <= 0) return { ok: true, amount: 0 };

  await incTreasuryBalance(db, input.countryId, -amount, now);
  await db
    .collection<Corporation>("corporations")
    .updateOne(
      { _id: input.corpId },
      { $inc: { liquidCapital: amount }, $set: { updatedAt: now } }
    );
  return { ok: true, amount };
}

/**
 * Per-turn NatCorp profit remittance (spec P6g §5.1): move `amountLocal` from the
 * corp's liquidCapital to the treasury. Inverse of {@link drawFromTreasury}.
 * Returns the amount moved. The corp's profit has already accrued to liquidCapital
 * in the corp turn, so this just transfers the remitted share out.
 */
export async function remitToTreasury(
  db: Db,
  input: { countryId: CountryId; corpId: ObjectId; amountLocal: number },
  now: Date
): Promise<number> {
  const amount = Math.round(input.amountLocal);
  if (amount <= 0) return 0;

  await db
    .collection<Corporation>("corporations")
    .updateOne(
      { _id: input.corpId },
      { $inc: { liquidCapital: -amount }, $set: { updatedAt: now } }
    );
  await incTreasuryBalance(db, input.countryId, amount, now);
  return amount;
}

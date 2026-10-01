/**
 * Plans and applies the savings lifecycle repairs for accounts opened or
 * orphaned before authoritative account lifecycle hooks were installed.
 * The default is read-only; missing-holder losses require explicit acceptance.
 */
import { ObjectId, type Db } from "mongodb";
import type { SavingsAccount } from "@/lib/db/types/savingsAccount";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { getCurrentTurn } from "@/lib/currentTurn";
import { getBankId } from "@/lib/centralBank/helpers";
import { getCountryIdForCurrency, type CurrencyCode } from "@/lib/constants/currencies";
import { settleTransition } from "@/lib/banking/settlementJournal";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import { buildSavingsComparison, loadLegacySavingsRows, readCohort } from "./shadow";
import { closeCharacterSavings } from "./closeCharacterSavings";
import { toAccountSnapshot } from "./snapshot";
import { savingsRoundingRepair } from "./rules/roundingRepair";
import { isBankHolder } from "./rules/accounts";

export async function repairSavingsLifecycle(
  db: Db,
  options: { apply?: boolean; allowMissingHolderWriteOff?: boolean } = {}
) {
  const [policy, turn, rows, accounts, owners, holders] = await Promise.all([
    loadBankingPolicy(db),
    getCurrentTurn(db),
    loadLegacySavingsRows(db),
    db.collection<SavingsAccount>("savingsAccounts").find({ ownerType: "character" }).toArray(),
    db
      .collection("characters")
      .find({}, { projection: { _id: 1 } })
      .toArray(),
    db
      .collection("corporations")
      .find({ bankCharter: { $exists: true } }, { projection: { _id: 1 } })
      .toArray(),
  ]);
  const before = await buildSavingsComparison(db, turn, {
    authoritativeCurrencies: readCohort(policy),
  });
  const ownerIds = new Set(owners.map((owner) => String(owner._id)));
  const holderIds = new Set(holders.map((holder) => String(holder._id)));
  const accountKeys = new Set(accounts.map((account) => `${account.ownerId}:${account.currency}`));
  const missing = rows.filter(
    (row) => row.opened && row.savings === 0 && !accountKeys.has(`${row.ownerId}:${row.currency}`)
  );
  const orphans = accounts.filter(
    (account) => account.status !== "closed" && !ownerIds.has(String(account.ownerId))
  );
  const rounding = accounts.filter(
    (account) =>
      ownerIds.has(String(account.ownerId)) &&
      savingsRoundingRepair(toAccountSnapshot(account), "", turn) !== null
  );
  const missingHolders = orphans.filter(
    (account) => isBankHolder(account.holder) && !holderIds.has(account.holder)
  );
  const writeOffs: Record<string, number> = {};
  for (const account of missingHolders)
    writeOffs[account.currency] = (writeOffs[account.currency] ?? 0) + Math.max(0, account.balance);
  const summary = {
    turn,
    applied: false,
    discrepanciesBefore: before.totalDiscrepancies,
    discrepanciesAfter: before.totalDiscrepancies,
    emptyAccounts: missing.length,
    orphanAccounts: orphans.length,
    roundingAccounts: rounding.length,
    missingHolderWriteOffs: writeOffs,
  };
  if (!options.apply) return summary;
  if (policy.savingsAccounts !== "authoritative")
    throw new Error("Lifecycle repair requires authoritative savings");
  if (missingHolders.length && !options.allowMissingHolderWriteOff)
    throw new Error(
      "Review and explicitly accept the missing-holder claim write-offs before applying"
    );
  const affectedCurrencies = new Set(
    [...missing, ...orphans, ...rounding].map((row) => row.currency)
  );
  if ([...affectedCurrencies].some((currency) => !policy.savingsReadCurrencies.includes(currency)))
    throw new Error("Every affected currency must be in the authoritative read cohort");
  if (
    await db
      .collection(MONEY_MOVE_COLLECTION)
      .countDocuments({ status: { $in: ["pending", "partial"] } })
  )
    throw new Error("Finish pending banking settlements before lifecycle repair");
  for (const ownerId of new Set(orphans.map((account) => String(account.ownerId))))
    await closeCharacterSavings(db, new ObjectId(ownerId), options);
  const { ensureSavingsAccount } = await import("./accountsShell");
  for (const row of missing)
    if (
      !(await ensureSavingsAccount(
        db,
        new ObjectId(row.ownerId),
        row.currency as CurrencyCode,
        turn
      ))
    )
      throw new Error("An empty account could not be created");
  for (const account of rounding) {
    const transition = savingsRoundingRepair(
      toAccountSnapshot(account),
      getBankId(getCountryIdForCurrency(account.currency)),
      turn
    );
    if (!transition) continue;
    const settled = await settleTransition(db, transition);
    if (settled.status !== "applied" && settled.status !== "replayed")
      throw new Error("A rounding repair requires settlement recovery");
  }
  const after = await buildSavingsComparison(db, turn, {
    authoritativeCurrencies: readCohort(policy),
  });
  return { ...summary, applied: true, discrepanciesAfter: after.totalDiscrepancies };
}

import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { BankLoan, InterbankLoan } from "@/lib/db/types/bank";
import type { SavingsAccount } from "@/lib/db/types/savingsAccount";
import type { Character } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";

export type TransferBankCharterResult =
  | {
      ok: true;
      transferred: boolean;
      currency: CurrencyCode | null;
      loansRekeyed: number;
      interbankSidesRekeyed: number;
      savingsAccountsRekeyed: number;
      depositorPointersRekeyed: number;
    }
  | { ok: false; error: string };

const NO_COUNTS = {
  loansRekeyed: 0,
  interbankSidesRekeyed: 0,
  savingsAccountsRekeyed: 0,
  depositorPointersRekeyed: 0,
} as const;

/**
 * Player-facing reason a merge cannot proceed: the target operates a live bank
 * while the acquirer already holds a charter. A corporation carries a single
 * `bankCharter` sub-document, so there is nowhere to put the second bank.
 * Shared by the pre-money-move guards so every merge path reports the same
 * message. Returns null when there is no conflict.
 */
export function bankTransferConflict(
  target: Pick<Corporation, "name" | "bankCharter">,
  acquirer: Pick<Corporation, "name" | "bankCharter">
): string | null {
  if (target.bankCharter?.status === "active" && acquirer.bankCharter) {
    return (
      `Cannot merge ${target.name}: ${acquirer.name} already operates a bank. ` +
      `A corporation can operate only one bank — revoke one of the two charters first, then merge again.`
    );
  }
  return null;
}

/**
 * Move a bank charter from an absorbed corporation to its acquirer, re-keying
 * every satellite record that names the old owner.
 *
 * Why this exists (ticket-1267): the charter is a sub-document on the
 * corporation, so deleting the absorbed shell deleted its bank with it — the
 * charter (including ring-fenced `cashReserves`), the loan book, and every
 * depositor pointer. Sectors and bonds already re-parent on merge; the bank
 * is the same class of asset and must move the same way.
 *
 * What moves with the charter: `bankLoans` rows, both sides of
 * `interbankLoans`, authoritative `savingsAccounts` (open/frozen — closed
 * accounts are zero-balance history and stay as written), and the legacy
 * per-character `savingsHolder` projection for the charter currency. The
 * ring-fenced cash, NPC book, prop book, debts and blacklist are charter
 * fields and travel inside the sub-document; turn processors resolve the bank
 * by owner id, so they follow automatically.
 *
 * Conflict rule: an active charter cannot move into an occupied slot, so that
 * case reports an error and the caller must refuse the merge BEFORE any money
 * moves. An inert (revoked/failed) charter moves into a free slot so dead-bank
 * estate recovery keeps resolving under the surviving owner; when the slot is
 * occupied the dead record dies with the shell, exactly as before.
 */
export async function transferBankCharterToAcquirer(
  db: Db,
  targetId: ObjectId,
  acquirerId: ObjectId,
  now: Date
): Promise<TransferBankCharterResult> {
  if (targetId.equals(acquirerId)) {
    return { ok: false, error: "A corporation cannot absorb itself" };
  }
  const corps = db.collection<Corporation>("corporations");
  const [target, acquirer] = await Promise.all([
    corps.findOne({ _id: targetId }, { projection: { name: 1, bankCharter: 1 } }),
    corps.findOne({ _id: acquirerId }, { projection: { name: 1, bankCharter: 1 } }),
  ]);
  if (!target) return { ok: false, error: "Target corporation no longer exists" };
  if (!acquirer) return { ok: false, error: "Acquiring corporation no longer exists" };

  const charter = target.bankCharter ?? null;
  if (!charter) {
    return { ok: true, transferred: false, currency: null, ...NO_COUNTS };
  }
  const conflict = bankTransferConflict(target, acquirer);
  if (conflict) return { ok: false, error: conflict };
  if (charter.status !== "active" && acquirer.bankCharter) {
    return { ok: true, transferred: false, currency: null, ...NO_COUNTS };
  }

  // Claim the acquirer's charter slot, guarded: a charter issued on the
  // acquirer between the caller's pre-check and this write must fail here
  // rather than overwrite a live bank.
  const claim = await corps.updateOne(
    { _id: acquirerId, bankCharter: { $exists: false } },
    { $set: { bankCharter: charter, updatedAt: now } }
  );
  if (claim.modifiedCount !== 1) {
    return {
      ok: false,
      error: `Cannot merge ${target.name}: ${acquirer.name} gained a bank charter during the merge. Try again.`,
    };
  }

  // Release the charter from the target, guarded on identity: if the target
  // changed under us (a concurrent merge of the same shell), roll the claim
  // back so the bank exists in exactly one place.
  const release = await corps.updateOne(
    {
      _id: targetId,
      "bankCharter.currency": charter.currency,
      "bankCharter.charteredTurn": charter.charteredTurn,
      "bankCharter.type": charter.type,
      "bankCharter.status": charter.status,
    },
    { $unset: { bankCharter: "" }, $set: { updatedAt: now } }
  );
  if (release.modifiedCount !== 1) {
    await corps.updateOne(
      {
        _id: acquirerId,
        "bankCharter.currency": charter.currency,
        "bankCharter.charteredTurn": charter.charteredTurn,
      },
      { $unset: { bankCharter: "" }, $set: { updatedAt: now } }
    );
    return {
      ok: false,
      error: `Cannot merge ${target.name}: its bank changed during the merge. Try again.`,
    };
  }

  const targetHex = targetId.toString();
  const acquirerHex = acquirerId.toString();
  const holderPath = `currencyBalances.savingsHolder.${charter.currency}` as const;

  const [loans, interbankLent, interbankBorrowed, accounts, pointers] = await Promise.all([
    db
      .collection<BankLoan>("bankLoans")
      .updateMany(
        { bankCorporationId: targetId },
        { $set: { bankCorporationId: acquirerId, updatedAt: now } }
      ),
    db
      .collection<InterbankLoan>("interbankLoans")
      .updateMany(
        { lenderCorporationId: targetId },
        { $set: { lenderCorporationId: acquirerId, updatedAt: now } }
      ),
    db
      .collection<InterbankLoan>("interbankLoans")
      .updateMany(
        { borrowerCorporationId: targetId },
        { $set: { borrowerCorporationId: acquirerId, updatedAt: now } }
      ),
    db
      .collection<SavingsAccount>("savingsAccounts")
      .updateMany(
        { holder: targetHex, status: { $ne: "closed" } },
        { $set: { holder: acquirerHex, updatedAt: now } }
      ),
    db
      .collection<Character>("characters")
      .updateMany(
        { [holderPath]: targetHex },
        { $set: { [holderPath]: acquirerHex, updatedAt: now } }
      ),
  ]);

  return {
    ok: true,
    transferred: true,
    currency: charter.currency as CurrencyCode,
    loansRekeyed: loans.modifiedCount ?? 0,
    interbankSidesRekeyed:
      (interbankLent.modifiedCount ?? 0) + (interbankBorrowed.modifiedCount ?? 0),
    savingsAccountsRekeyed: accounts.modifiedCount ?? 0,
    depositorPointersRekeyed: pointers.modifiedCount ?? 0,
  };
}

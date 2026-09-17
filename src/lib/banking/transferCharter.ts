import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { BankCharter, BankLoan, InterbankLoan } from "@/lib/db/types/bank";
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

function sameId(a: ObjectId, b: ObjectId): boolean {
  return a.toString() === b.toString();
}

function sameCharterIdentity(a: BankCharter, b: BankCharter): boolean {
  return (
    a.currency === b.currency &&
    a.charteredTurn === b.charteredTurn &&
    a.type === b.type &&
    a.status === b.status
  );
}

function identityFilter(charter: BankCharter): Record<string, unknown> {
  return {
    "bankCharter.currency": charter.currency,
    "bankCharter.charteredTurn": charter.charteredTurn,
    "bankCharter.type": charter.type,
    "bankCharter.status": charter.status,
  };
}

async function rekeySatellites(
  db: Db,
  targetId: ObjectId,
  destId: ObjectId,
  currency: CurrencyCode,
  now: Date
): Promise<{
  loansRekeyed: number;
  interbankSidesRekeyed: number;
  savingsAccountsRekeyed: number;
  depositorPointersRekeyed: number;
}> {
  // Sequential on purpose: each write is an idempotent set keyed on the old
  // owner, so a throw between writes leaves a well-defined prefix behind and
  // the next attempt resumes it. Firing them together would leave an
  // ambiguous subset applied on failure.
  const targetHex = targetId.toString();
  const destHex = destId.toString();
  const holderPath = `currencyBalances.savingsHolder.${currency}` as const;

  const loans = await db
    .collection<BankLoan>("bankLoans")
    .updateMany(
      { bankCorporationId: targetId },
      { $set: { bankCorporationId: destId, updatedAt: now } }
    );
  const interbankLent = await db
    .collection<InterbankLoan>("interbankLoans")
    .updateMany(
      { lenderCorporationId: targetId },
      { $set: { lenderCorporationId: destId, updatedAt: now } }
    );
  const interbankBorrowed = await db
    .collection<InterbankLoan>("interbankLoans")
    .updateMany(
      { borrowerCorporationId: targetId },
      { $set: { borrowerCorporationId: destId, updatedAt: now } }
    );
  const accounts = await db
    .collection<SavingsAccount>("savingsAccounts")
    .updateMany(
      { holder: targetHex, status: { $ne: "closed" } },
      { $set: { holder: destHex, updatedAt: now } }
    );
  const pointers = await db
    .collection<Character>("characters")
    .updateMany({ [holderPath]: targetHex }, { $set: { [holderPath]: destHex, updatedAt: now } });

  return {
    loansRekeyed: loans.modifiedCount ?? 0,
    interbankSidesRekeyed:
      (interbankLent.modifiedCount ?? 0) + (interbankBorrowed.modifiedCount ?? 0),
    savingsAccountsRekeyed: accounts.modifiedCount ?? 0,
    depositorPointersRekeyed: pointers.modifiedCount ?? 0,
  };
}

async function clearPlan(db: Db, targetId: ObjectId, destId: ObjectId, now: Date): Promise<void> {
  // Guarded on the planned owner so two concurrent resumers cannot clear a
  // newer plan stamped after this attempt read. A throw here propagates: the
  // re-keys above already landed, so the retry re-runs them as no-ops and
  // clears the plan then. Either order converges.
  await db
    .collection<Corporation>("corporations")
    .updateOne(
      { _id: targetId, "bankCharterTransfer.to": destId },
      { $unset: { bankCharterTransfer: "" }, $set: { updatedAt: now } }
    );
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
 *
 * Crash safety (issue #2014): production Mongo has no multi-document
 * transactions (see `runWithOptionalTransaction`), so the claim, release, and
 * re-keys cannot commit atomically. Instead the shell carries a durable
 * recovery plan (`bankCharterTransfer`: planned owner plus charter currency)
 * stamped before the claim and cleared after the last re-key. Every satellite
 * write is an idempotent set keyed on the old owner, so an interruption or
 * throw after ANY durable write converges on retry: a charterless shell with
 * a surviving plan resumes its re-keys toward the planned owner instead of
 * reporting "no transfer required" over split records, and a shell that still
 * holds its charter resumes at the guarded claim/release. Concurrent
 * same-pair retries are safe for the same reason; nothing here reports
 * success while split.
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
    corps.findOne(
      { _id: targetId },
      { projection: { name: 1, bankCharter: 1, bankCharterTransfer: 1 } }
    ),
    corps.findOne(
      { _id: acquirerId },
      { projection: { name: 1, bankCharter: 1, bankCharterTransfer: 1 } }
    ),
  ]);
  if (!target) return { ok: false, error: "Target corporation no longer exists" };
  if (!acquirer) return { ok: false, error: "Acquiring corporation no longer exists" };

  const charter = target.bankCharter ?? null;
  const plan =
    target.bankCharterTransfer?.to && target.bankCharterTransfer?.currency
      ? target.bankCharterTransfer
      : null;

  if (!charter) {
    if (!plan) {
      return { ok: true, transferred: false, currency: null, ...NO_COUNTS };
    }
    // The charter already moved but a crash or throw interrupted the
    // satellite re-keys (or their ack). Resume toward the planned owner and
    // only then clear the plan, so this call never reports "nothing to do"
    // while records still name the shell.
    const destId = plan.to;
    const counts = await rekeySatellites(db, targetId, destId, plan.currency, now);
    await clearPlan(db, targetId, destId, now);
    return { ok: true, transferred: true, currency: plan.currency, ...counts };
  }

  // A charter on the acquirer that matches this one by identity, plus a plan
  // naming this acquirer, is our own earlier claim interrupted before release
  // — not a conflict and not an occupied slot. Resume instead of refusing.
  const ownClaim =
    !!acquirer.bankCharter &&
    !!plan &&
    sameId(plan.to, acquirerId) &&
    sameCharterIdentity(acquirer.bankCharter, charter);
  const conflict = bankTransferConflict(target, acquirer);
  if (conflict && !ownClaim) return { ok: false, error: conflict };
  if (charter.status !== "active" && acquirer.bankCharter && !ownClaim) {
    return { ok: true, transferred: false, currency: null, ...NO_COUNTS };
  }

  // A previous attempt aimed at a DIFFERENT acquirer may have left its claim
  // behind (crash between its claim and release). Remove that orphan copy
  // first: the identity guard means a foreign bank never matches. This runs
  // before stamping so a crash between the two simply repeats the idempotent
  // cleanup on retry.
  const prevTo = plan && !sameId(plan.to, acquirerId) ? plan.to : null;
  if (prevTo) {
    await corps.updateOne(
      { _id: prevTo, ...identityFilter(charter) },
      { $unset: { bankCharter: "" }, $set: { updatedAt: now } }
    );
  }

  // Stamp the recovery plan before the claim: any crash from here on has a
  // durable record of where the charter is going and which currency the
  // depositor pointers use.
  await corps.updateOne(
    { _id: targetId },
    {
      $set: {
        bankCharterTransfer: {
          to: acquirerId,
          currency: charter.currency,
          startedAt: now,
        },
        updatedAt: now,
      },
    }
  );

  // Claim the acquirer's charter slot, guarded: a charter issued on the
  // acquirer between the caller's pre-check and this write must fail here
  // rather than overwrite a live bank. A miss while the acquirer already
  // holds our own claimed copy is the interrupted-claim case above racing us;
  // anything else is a genuine race and errors as before.
  if (!ownClaim) {
    const claim = await corps.updateOne(
      { _id: acquirerId, bankCharter: { $exists: false } },
      { $set: { bankCharter: charter, updatedAt: now } }
    );
    if (claim.modifiedCount !== 1) {
      const raced = await corps.findOne({ _id: acquirerId }, { projection: { bankCharter: 1 } });
      if (
        raced?.bankCharter &&
        sameCharterIdentity(raced.bankCharter, charter) &&
        (await corps
          .findOne({ _id: targetId }, { projection: { bankCharterTransfer: 1 } })
          .then((t) => !!t?.bankCharterTransfer && sameId(t.bankCharterTransfer.to, acquirerId)))
      ) {
        // Lost the claim race to our own sibling attempt; it will drive the
        // release, and our call below resumes the shared re-keys.
      } else {
        return {
          ok: false,
          error: `Cannot merge ${target.name}: ${acquirer.name} gained a bank charter during the merge. Try again.`,
        };
      }
    }
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
    const reread = await corps.findOne(
      { _id: targetId },
      { projection: { bankCharter: 1, bankCharterTransfer: 1 } }
    );
    const releasedByUs =
      !reread?.bankCharter &&
      !!reread?.bankCharterTransfer &&
      sameId(reread.bankCharterTransfer.to, acquirerId);
    if (releasedByUs) {
      // Our own earlier attempt (or a same-pair sibling) already released;
      // fall through to the shared idempotent re-keys.
    } else {
      // Either the shell genuinely changed under us, or another acquirer won
      // this shell. Roll our claim back (identity-guarded: never touches a
      // foreign bank) and report, exactly as before. The winner, if any,
      // converges through its own plan.
      if (!reread?.bankCharter) {
        const holders = await corps
          .find({ ...identityFilter(charter) }, { projection: { _id: 1 } })
          .toArray();
        if (holders.every((h) => sameId(h._id as ObjectId, acquirerId))) {
          // No foreign holder: the only copy is ours, so our release simply
          // landed on an earlier attempt whose ack was lost. Resume re-keys.
          const counts = await rekeySatellites(db, targetId, acquirerId, charter.currency, now);
          await clearPlan(db, targetId, acquirerId, now);
          return {
            ok: true,
            transferred: true,
            currency: charter.currency as CurrencyCode,
            ...counts,
          };
        }
      }
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
  }

  const counts = await rekeySatellites(db, targetId, acquirerId, charter.currency, now);
  await clearPlan(db, targetId, acquirerId, now);

  return {
    ok: true,
    transferred: true,
    currency: charter.currency as CurrencyCode,
    ...counts,
  };
}

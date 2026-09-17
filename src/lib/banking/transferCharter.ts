import { ObjectId, type Db } from "mongodb";
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

/**
 * Ownership fingerprint of the charter being moved. Covers the claim/release
 * identity (currency, charteredTurn, type, status) plus the economic fields,
 * so a genuinely different bank that happens to share the identity metadata
 * (same turn, same type) never reads as our own claimed copy. Compared with
 * the fingerprint stamped in the recovery plan on every resume, release,
 * cleanup, re-key, and plan-clear decision.
 */
export function charterFingerprint(charter: BankCharter): string {
  const fields: unknown[] = [
    charter.currency,
    charter.charteredTurn,
    charter.type,
    charter.status,
    charter.postedCapital,
    charter.depositOffset,
    charter.lendingOffset,
    charter.cashReserves,
    charter.npcDeposits,
    charter.playerDeposits,
    charter.totalLoans,
    charter.totalDeposits,
  ];
  return fields.map((v) => (v === undefined || v === null ? "∅" : String(v))).join("|");
}

function fingerprintFilter(charter: BankCharter): Record<string, unknown> {
  const entries: [string, unknown][] = [
    ["currency", charter.currency],
    ["charteredTurn", charter.charteredTurn],
    ["type", charter.type],
    ["status", charter.status],
    ["postedCapital", charter.postedCapital],
    ["depositOffset", charter.depositOffset],
    ["lendingOffset", charter.lendingOffset],
    ["cashReserves", charter.cashReserves],
    ["npcDeposits", charter.npcDeposits],
    ["playerDeposits", charter.playerDeposits],
    ["totalLoans", charter.totalLoans],
    ["totalDeposits", charter.totalDeposits],
  ];
  const filter: Record<string, unknown> = {};
  for (const [field, value] of entries) {
    filter[`bankCharter.${field}`] =
      value === undefined || value === null ? { $exists: false } : value;
  }
  return filter;
}

function identityFilter(charter: BankCharter): Record<string, unknown> {
  return {
    "bankCharter.currency": charter.currency,
    "bankCharter.charteredTurn": charter.charteredTurn,
    "bankCharter.type": charter.type,
    "bankCharter.status": charter.status,
  };
}

type CharterTransferPlan = NonNullable<Corporation["bankCharterTransfer"]>;

function isOwnedPlan(plan: CharterTransferPlan | null | undefined): plan is CharterTransferPlan & {
  attemptId: string;
  fingerprint: string;
} {
  return (
    !!plan &&
    !!plan.to &&
    !!plan.currency &&
    typeof plan.attemptId === "string" &&
    plan.attemptId.length > 0 &&
    typeof plan.fingerprint === "string" &&
    plan.fingerprint.length > 0
  );
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

async function clearPlan(
  db: Db,
  targetId: ObjectId,
  destId: ObjectId,
  attemptId: string,
  now: Date
): Promise<void> {
  // Guarded on the planned owner AND the owning attempt token, so two
  // concurrent resumers cannot clear a newer plan stamped after this attempt
  // read, and a loser that lost the plan race cannot clear the winner's plan.
  // A throw here propagates: the re-keys above already landed, so the retry
  // re-runs them as no-ops and clears the plan then. Either order converges.
  await db.collection<Corporation>("corporations").updateOne(
    {
      _id: targetId,
      "bankCharterTransfer.to": destId,
      "bankCharterTransfer.attemptId": attemptId,
    },
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
 *
 * Concurrency hardening (PR #2016): the plan additionally carries a unique
 * attempt token plus a charter fingerprint, stamped once and claimed
 * atomically. Concurrent transfers of one shell to DIFFERENT acquirers used
 * to overwrite each other's plan, so the loser could mistake the winner's
 * release for its own and re-key satellites toward itself. Now every resume,
 * release, cleanup, re-key, and plan-clear decision requires the token:
 * only the plan owner releases the charter and drives the re-keys, a loser
 * returns conflict without writing charter or satellite state, and same-pair
 * retries join the shared plan by (owner, fingerprint) and converge without
 * double-apply. Retargeting a shell whose charter never left (stale foreign
 * plan plus orphan claim) stays safe: the adopt is a compare-and-swap on the
 * old token guarded on the shell still holding the charter, and the orphan
 * cleanup is fingerprint-guarded so it never touches a foreign bank.
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
  const rawPlan =
    target.bankCharterTransfer?.to && target.bankCharterTransfer?.currency
      ? target.bankCharterTransfer
      : null;
  const plan = isOwnedPlan(rawPlan) ? rawPlan : null;

  if (!charter) {
    if (!rawPlan) {
      return { ok: true, transferred: false, currency: null, ...NO_COUNTS };
    }
    if (!plan) {
      // Stamped before ownership tokens existed: no proof which attempt owns
      // it, so no resume. Report conflict without writing anything; the shell
      // still holding its charter would have let a retarget adopt it, but a
      // charterless shell with an unowned plan is someone else's in-flight
      // transfer (or a strand from before tokens) and must not be re-keyed
      // blindly toward any caller.
      return {
        ok: false,
        error: `Cannot merge ${target.name}: its bank transfer was interrupted before ownership tracking. Try again.`,
      };
    }
    if (!sameId(plan.to, acquirerId)) {
      // Another acquirer's transfer is in flight (or crashed mid-re-key):
      // conflict without touching charter or satellite state.
      return {
        ok: false,
        error: `Cannot merge ${target.name}: its bank transfer is held by another merge. Try again.`,
      };
    }
    // The charter already moved but a crash or throw interrupted the
    // satellite re-keys (or their ack). Resume toward the planned owner and
    // only then clear the plan, so this call never reports "nothing to do"
    // while records still name the shell.
    const destId = plan.to;
    const counts = await rekeySatellites(db, targetId, destId, plan.currency, now);
    await clearPlan(db, targetId, destId, plan.attemptId, now);
    return { ok: true, transferred: true, currency: plan.currency, ...counts };
  }

  const fingerprint = charterFingerprint(charter);

  // A charter on the acquirer that matches this one by full fingerprint, plus
  // a token-owned plan naming this acquirer, is our own earlier claim
  // interrupted before release — not a conflict and not an occupied slot.
  // Fingerprint (not just identity metadata) is required so a genuinely
  // different bank that shares currency/turn/type/status never reads as ours.
  const ownClaim =
    !!acquirer.bankCharter &&
    !!plan &&
    sameId(plan.to, acquirerId) &&
    plan.fingerprint === fingerprint &&
    charterFingerprint(acquirer.bankCharter) === fingerprint;
  const conflict = bankTransferConflict(target, acquirer);
  if (conflict && !ownClaim) return { ok: false, error: conflict };
  if (charter.status !== "active" && acquirer.bankCharter && !ownClaim) {
    return { ok: true, transferred: false, currency: null, ...NO_COUNTS };
  }

  const attemptId = new ObjectId().toHexString();
  const stampPlan = {
    to: acquirerId,
    currency: charter.currency,
    attemptId,
    fingerprint,
    startedAt: now,
  };

  // Claim plan ownership atomically. The first attempt wins with a guarded
  // stamp; a same-pair sibling (same owner, same fingerprint) joins the
  // shared plan; anything else must adopt via compare-and-swap on the old
  // token, guarded on the shell still holding this charter — a shell that
  // already released is someone's in-flight transfer and is never adopted.
  let owned: string | null = null;
  let prevTo: ObjectId | null = null;
  const stamp = await corps.updateOne(
    { _id: targetId, bankCharterTransfer: { $exists: false } },
    { $set: { bankCharterTransfer: stampPlan, updatedAt: now } }
  );
  if (stamp.modifiedCount === 1) {
    owned = attemptId;
  } else {
    const current = await corps.findOne(
      { _id: targetId },
      { projection: { bankCharter: 1, bankCharterTransfer: 1 } }
    );
    const curPlan = isOwnedPlan(current?.bankCharterTransfer) ? current?.bankCharterTransfer : null;
    const curRaw =
      current?.bankCharterTransfer?.to && current?.bankCharterTransfer?.currency
        ? current.bankCharterTransfer
        : null;
    if (
      curPlan &&
      sameId(curPlan.to, acquirerId) &&
      curPlan.fingerprint === fingerprint &&
      curPlan.currency === charter.currency
    ) {
      // Same-pair sibling (or our own lost-ack retry): drive jointly.
      owned = curPlan.attemptId;
    } else if (curRaw && !sameId(curRaw.to, acquirerId)) {
      // Foreign plan: adopt only while the shell still holds this charter.
      // The token CAS means exactly one adopter wins; losers conflict below
      // without writing anything.
      const adopt = await corps.updateOne(
        {
          _id: targetId,
          ...identityFilter(charter),
          ...(isOwnedPlan(curRaw)
            ? { "bankCharterTransfer.attemptId": curRaw.attemptId }
            : { "bankCharterTransfer.to": curRaw.to }),
        },
        { $set: { bankCharterTransfer: stampPlan, updatedAt: now } }
      );
      if (adopt.modifiedCount === 1) {
        owned = attemptId;
        prevTo = curRaw.to;
      }
    } else if (!curRaw) {
      // Plan vanished under us (winner completed and cleared, or a rollback);
      // one restamp decides it.
      const restamp = await corps.updateOne(
        { _id: targetId, bankCharterTransfer: { $exists: false } },
        { $set: { bankCharterTransfer: stampPlan, updatedAt: now } }
      );
      if (restamp.modifiedCount === 1) owned = attemptId;
    }
  }
  if (!owned) {
    // Lost the plan race, or the shell no longer holds this charter for us
    // to adopt. Conflict with zero writes: no claim, no release, no re-key.
    return {
      ok: false,
      error: `Cannot merge ${target.name}: its bank transfer was claimed by another merge. Try again.`,
    };
  }

  // A previous attempt aimed at a DIFFERENT acquirer may have left its claim
  // behind (crash between its claim and release). Remove that orphan copy
  // first: the fingerprint guard means a foreign bank never matches. This
  // runs before claiming so a crash between the two simply repeats the
  // idempotent cleanup on retry. Only the plan owner reaches here, and only
  // with the shell still holding the charter, so the copy is provably orphan.
  if (prevTo && !sameId(prevTo, acquirerId)) {
    await corps.updateOne(
      { _id: prevTo, ...fingerprintFilter(charter) },
      { $unset: { bankCharter: "" }, $set: { updatedAt: now } }
    );
  }

  // Claim the acquirer's charter slot, guarded: a charter issued on the
  // acquirer between the caller's pre-check and this write must fail here
  // rather than overwrite a live bank. A miss while the acquirer already
  // holds our own claimed copy under the shared plan is the
  // interrupted-claim case racing us; anything else is a genuine race and
  // errors as before.
  let claimedOurs = false;
  if (!ownClaim) {
    const claim = await corps.updateOne(
      { _id: acquirerId, bankCharter: { $exists: false } },
      { $set: { bankCharter: charter, updatedAt: now } }
    );
    if (claim.modifiedCount === 1) {
      claimedOurs = true;
    } else {
      const [raced, planNow] = await Promise.all([
        corps.findOne({ _id: acquirerId }, { projection: { bankCharter: 1 } }),
        corps.findOne({ _id: targetId }, { projection: { bankCharterTransfer: 1 } }),
      ]);
      const shared = isOwnedPlan(planNow?.bankCharterTransfer) ? planNow.bankCharterTransfer : null;
      if (
        raced?.bankCharter &&
        charterFingerprint(raced.bankCharter) === fingerprint &&
        !!shared &&
        shared.attemptId === owned &&
        sameId(shared.to, acquirerId)
      ) {
        // Lost the claim race to our own sibling attempt; it will drive the
        // release, and our call below resumes the shared re-keys. Never our
        // copy to roll back.
      } else {
        return {
          ok: false,
          error: `Cannot merge ${target.name}: ${acquirer.name} gained a bank charter during the merge. Try again.`,
        };
      }
    }
  }

  // Release the charter from the target, guarded on identity AND the owned
  // attempt token: if another acquirer won this shell, our release misses
  // instead of treating the winner's release as our own. On a miss we roll
  // back only our own claim (fingerprint-guarded, own slot only) so the
  // bank exists in exactly one place.
  const release = await corps.updateOne(
    {
      _id: targetId,
      ...identityFilter(charter),
      "bankCharterTransfer.attemptId": owned,
      "bankCharterTransfer.to": acquirerId,
    },
    { $unset: { bankCharter: "" }, $set: { updatedAt: now } }
  );
  if (release.modifiedCount !== 1) {
    const reread = await corps.findOne(
      { _id: targetId },
      { projection: { bankCharter: 1, bankCharterTransfer: 1 } }
    );
    const rereadPlan = isOwnedPlan(reread?.bankCharterTransfer)
      ? reread?.bankCharterTransfer
      : null;
    const releasedUnderSharedPlan =
      !reread?.bankCharter &&
      !!rereadPlan &&
      rereadPlan.attemptId === owned &&
      sameId(rereadPlan.to, acquirerId);
    if (releasedUnderSharedPlan) {
      // Our own earlier attempt (or a same-pair sibling) already released;
      // fall through to the shared idempotent re-keys.
    } else {
      // Either the shell genuinely changed under us, or another acquirer won
      // this shell. Roll our claim back when this call made one
      // (fingerprint-guarded: never touches a foreign bank) and report. The
      // winner, if any, converges through its own plan; we write nothing
      // else — in particular no re-key toward ourselves.
      if (claimedOurs) {
        await corps.updateOne(
          { _id: acquirerId, ...fingerprintFilter(charter) },
          { $unset: { bankCharter: "" }, $set: { updatedAt: now } }
        );
      }
      return {
        ok: false,
        error: `Cannot merge ${target.name}: its bank changed during the merge. Try again.`,
      };
    }
  }

  const counts = await rekeySatellites(db, targetId, acquirerId, charter.currency, now);
  await clearPlan(db, targetId, acquirerId, owned, now);

  return {
    ok: true,
    transferred: true,
    currency: charter.currency as CurrencyCode,
    ...counts,
  };
}

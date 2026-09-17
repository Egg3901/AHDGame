/**
 * Shared shell for account-cleanup share releases.
 *
 * Pure math lives in `./rules/shareRelease` (portable rules zone); this
 * module owns everything ambient: the bounded compare-and-swap write loop,
 * the attempt budget, and the conflict error. Both release entry points
 * (character-held and corporation-held) run the same per-issuer CAS through
 * {@link casReleaseIssuerFloat} so the retry, projection, and fail-closed
 * behavior cannot drift between them.
 */

import type { Collection, ObjectId } from "mongodb";
import type { Corporation, Shareholder } from "@/lib/db/types";
import {
  resolveReleaseFloat,
  selectReleaseRows,
  type ReleaseHolderKey,
  type ReleaseRowInput,
} from "./rules/shareRelease";

export type { ReleaseHolderKey, ReleaseRowInput, ReleaseSelection } from "./rules/shareRelease";
export { ShareReleaseValidationError } from "./rules/shareRelease";

/** Bounded compare-and-swap attempts per issuer before giving up. */
export const SHARE_RELEASE_CAS_ATTEMPTS = 5;

/**
 * The issuer changed under a release (or a write came back ambiguous). The
 * release must retry from a fresh read or, past its retry budget, stop so the
 * caller does not delete the holder on top of unreleased shares.
 */
export class ShareReleaseConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareReleaseConflictError";
  }
}

function toReleaseRowInput(row: Shareholder): ReleaseRowInput {
  return {
    characterId: row.characterId?.toString(),
    imperialCharacterId: row.imperialCharacterId?.toString(),
    corporationId: row.corporationId?.toString(),
    fundId: row.fundId?.toString(),
    nppId: row.nppId?.toString(),
    shares: row.shares,
  };
}

export interface CasReleaseIssuerFloatParams {
  corps: Collection<Corporation>;
  issuerId: ObjectId;
  snapshotHolders: Shareholder[];
  /** Raw stored float: only `undefined` means missing; anything else is validated. */
  snapshotFloat: unknown;
  key: ReleaseHolderKey;
  wanted: ReadonlySet<string>;
  now: Date;
}

export interface CasReleaseIssuerFloatOutcome {
  /** Total shares credited to this issuer's public float (0 when untouched). */
  shares: number;
  /** Shareholder array entries removed from this issuer (0 when untouched). */
  rows: number;
}

/**
 * Release one issuer's matching rows with a single conserving `$set` write
 * guarded by a compare-and-swap on the full shareholder snapshot plus the
 * snapshot float. A concurrent change retries from a fresh exact read within
 * the bounded attempt budget. Throws (never reports success) past the
 * budget, on malformed affected-row or float data, or on an ambiguous
 * (unacknowledged) write; the caller must NOT delete the holder then.
 *
 * Projections stay narrow (`_id`, `shareholders`, `publicFloat`) on every
 * read; the write is one `updateOne` per attempt.
 */
export async function casReleaseIssuerFloat(
  params: CasReleaseIssuerFloatParams
): Promise<CasReleaseIssuerFloatOutcome> {
  const { corps, issuerId, key, wanted, now } = params;
  let holders = params.snapshotHolders;
  let float: unknown = params.snapshotFloat;

  for (let attempt = 1; attempt <= SHARE_RELEASE_CAS_ATTEMPTS; attempt += 1) {
    const selection = selectReleaseRows(holders.map(toReleaseRowInput), key, wanted);
    if (selection.matchedIndexes.length === 0 || selection.sharesTotal <= 0) {
      return { shares: 0, rows: 0 };
    }
    const nextFloat = resolveReleaseFloat(float, selection.sharesTotal);
    const matched = new Set(selection.matchedIndexes);
    const remaining = holders.filter((_, index) => !matched.has(index));

    const res = await corps.updateOne(
      {
        _id: issuerId,
        shareholders: holders,
        ...(float === undefined
          ? { publicFloat: { $exists: false } }
          : { publicFloat: float as number }),
      },
      { $set: { shareholders: remaining, publicFloat: nextFloat, updatedAt: now } }
    );

    if (res.acknowledged !== true) {
      throw new ShareReleaseConflictError(
        "Share release write outcome unknown (issuer write not acknowledged); " +
          "reconcile before deleting the holder."
      );
    }
    if (res.matchedCount === 1 && res.modifiedCount === 1) {
      return { shares: selection.sharesTotal, rows: selection.matchedIndexes.length };
    }
    if (res.matchedCount === 1) {
      throw new ShareReleaseConflictError(
        "Share release write matched without modifying; holder rows left ambiguous " +
          "and shares not counted. Retry cleanup instead of deleting the holder."
      );
    }

    if (attempt === SHARE_RELEASE_CAS_ATTEMPTS) break;
    const fresh = await corps.findOne(
      { _id: issuerId },
      { projection: { _id: 1, shareholders: 1, publicFloat: 1 } }
    );
    if (!fresh) break;
    holders = fresh.shareholders ?? [];
    float = fresh.publicFloat;
  }

  throw new ShareReleaseConflictError(
    `Share release CAS conflict exhausted after ${SHARE_RELEASE_CAS_ATTEMPTS} attempts ` +
      "for one issuer; earlier issuers in this run may already have been credited. " +
      "Retry cleanup instead of deleting the holder."
  );
}

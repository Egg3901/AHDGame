/**
 * Portable share-release math for account-cleanup share releases.
 *
 * Rules zone: plain data in, plain data out. Holder ids arrive as strings,
 * there is no database, clock, randomness, environment or network access
 * here, and everything resolves synchronously so the logic stays portable to
 * any future host of these mechanics.
 */

/** Which holder key a release targets. Personal and corporate keys are never mixed. */
export type ReleaseHolderKey = "characterId" | "corporationId";

/**
 * Every holder-key kind the Shareholder contract allows. All keys are
 * optional on the stored row; exactly one is intended to be present.
 */
const HOLDER_KEYS = [
  "characterId",
  "imperialCharacterId",
  "corporationId",
  "fundId",
  "nppId",
] as const;

/** Minimal holder-row shape the selection math needs. Ids are strings. */
export interface ReleaseRowInput {
  characterId?: string;
  imperialCharacterId?: string;
  corporationId?: string;
  fundId?: string;
  nppId?: string;
  shares: number;
}

/** Indexes (into the issuer's shareholder array) selected for release, plus their total. */
export interface ReleaseSelection {
  matchedIndexes: number[];
  sharesTotal: number;
}

/** An affected row or float carries malformed data. The release must stop, not burn. */
export class ShareReleaseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareReleaseValidationError";
  }
}

function invalid(reason: string): never {
  throw new ShareReleaseValidationError(`Refusing share release: ${reason}.`);
}

function checkRowShares(shares: number, position: number): void {
  if (typeof shares !== "number") invalid(`affected row ${position} has a non-numeric share count`);
  if (!Number.isFinite(shares)) invalid(`affected row ${position} has a non-finite share count`);
  if (shares < 0) invalid(`affected row ${position} has a negative share count`);
}

/**
 * Select every row whose holder key is in `wanted`, summing their shares.
 * A row whose target key is absent (or not wanted) is ignored, including a
 * row keyed only by some other holder kind. An affected row (target key
 * wanted) that also carries any other holder key is ambiguous and fails
 * closed: the schema intends holder keys to be exclusive, so releasing it
 * could burn a position that partly belongs to someone else. Only affected
 * rows are validated: an unrelated malformed row never blocks a release,
 * while a malformed affected row fails it closed.
 */
export function selectReleaseRows(
  rows: readonly ReleaseRowInput[],
  key: ReleaseHolderKey,
  wanted: ReadonlySet<string>
): ReleaseSelection {
  const matchedIndexes: number[] = [];
  let sharesTotal = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const holder = row[key];
    if (holder === undefined || !wanted.has(holder)) continue;
    for (const other of HOLDER_KEYS) {
      if (other !== key && row[other] !== undefined) {
        invalid(`affected row ${index} carries multiple holder keys`);
      }
    }
    checkRowShares(row.shares, index);
    matchedIndexes.push(index);
    sharesTotal += row.shares;
    if (!Number.isFinite(sharesTotal)) invalid("running share total is non-finite");
  }
  if (!Number.isFinite(sharesTotal)) invalid("share total is non-finite");
  if (sharesTotal > Number.MAX_SAFE_INTEGER) invalid("share total exceeds safe integer range");
  return { matchedIndexes, sharesTotal };
}

/**
 * Resolve the issuer's next public float for a release. Only an absent
 * (`undefined`) float reads as zero, matching `$inc` on a missing field. Any
 * other malformed stored float (null, a non-number, NaN, a negative) fails
 * closed, as does an unsafe result.
 */
export function resolveReleaseFloat(oldFloat: unknown, sharesTotal: number): number {
  const base = oldFloat === undefined ? 0 : oldFloat;
  if (typeof base !== "number" || !Number.isFinite(base) || base < 0) {
    invalid("issuer publicFloat is malformed");
  }
  const next = base + sharesTotal;
  if (!Number.isFinite(next)) invalid("resulting publicFloat is non-finite");
  if (next > Number.MAX_SAFE_INTEGER) invalid("resulting publicFloat exceeds safe integer range");
  return next;
}

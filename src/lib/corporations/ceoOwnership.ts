/**
 * How much of a corporation its CEO owns, and why that matters. ceoOwnershipFraction
 * is the CEO's shares over total shares; when it exceeds 65%
 * (INSIDER_CONCENTRATION_THRESHOLD) a public corp is downgraded one credit notch
 * and its share price is discounted (insiderConcentrationPenaltyApplies).
 * Private corps are exempt.
 */
/**
 * CEO stake math, shared by the credit scorer, the share-price pass and the
 * bonds API.
 *
 * Deliberately its own module rather than living in `lib/bonds/corporateCredit`:
 * several turn tests mock that module wholesale, and a helper the turn path
 * calls on every corp must not vanish under a partial mock.
 */
import type { ObjectId } from "mongodb";

/** CEO stake above this fraction downgrades a public corp one credit notch. */
export const INSIDER_CONCENTRATION_THRESHOLD = 0.65;

/** CEO's stake as a fraction of totalShares (0–1). 0 for non-character CEOs. */
export function ceoOwnershipFraction(corp: {
  ceoType?: string;
  ceoId?: ObjectId | null;
  totalShares?: number;
  shareholders?: { characterId?: ObjectId; shares: number }[];
}): number {
  if (corp.ceoType !== "character" || !corp.ceoId || !(corp.totalShares ?? 0)) return 0;
  const entry = corp.shareholders?.find((sh) => sh.characterId?.equals(corp.ceoId!));
  return entry ? entry.shares / (corp.totalShares ?? 1) : 0;
}

/**
 * Whether the one-notch insider-concentration downgrade applies. Public corps
 * only — a private corp has no outside shareholders to be concentrated against.
 */
export function insiderConcentrationPenaltyApplies(corp: {
  ceoType?: string;
  ceoId?: ObjectId | null;
  totalShares?: number;
  shareholders?: { characterId?: ObjectId; shares: number }[];
  isPrivate?: boolean;
}): boolean {
  return !(corp.isPrivate ?? false) && ceoOwnershipFraction(corp) > INSIDER_CONCENTRATION_THRESHOLD;
}

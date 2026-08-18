import type { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types/corporation";

/**
 * Whether the minister writing a contract has a stake in the company receiving it.
 *
 * The concentration cap stops one supplier taking the whole national tranche, but it says
 * nothing about WHO owns that supplier. A minister awarding a third of the defence budget to
 * a corporation they run, or hold a block of, is the shape of the abuse the cap does not
 * reach - and the answer is not another cap. It is disclosure plus a political price, which
 * is what the rest of the game already does with corruption.
 *
 * "Close network" is honestly bounded to what the data actually supports: the same player,
 * and the minister's own recorded shareholding. There is no relationship graph between
 * characters, so anything wider would be invented rather than observed. Pure and testable.
 */

/** Share of a corporation that counts as a stake worth disclosing. */
export const MATERIAL_STAKE_SHARE = 0.05;

export type SelfDealingBasis = "owner" | "shareholding";

export interface SelfDealingFinding {
  /** The strongest relationship found, or null when the award is arm's length. */
  basis: SelfDealingBasis | null;
  /** Fraction of the corporation (0..1) the minister holds directly. 0 when none. */
  stakeShare: number;
}

/**
 * Resolve the awarding minister's interest in the supplying corporation.
 *
 * `owner` means the same player is on both sides of this contract. It reads `userId`, which
 * stays the APPOINTING owner even while a caretaker runs the corporation, so a minister
 * cannot launder the relationship by installing one.
 */
export function resolveSelfDealing(input: {
  corp: Pick<Corporation, "userId" | "shareholders" | "totalShares">;
  ministerUserId?: ObjectId | null;
  ministerCharacterId?: ObjectId | null;
}): SelfDealingFinding {
  const { corp, ministerUserId, ministerCharacterId } = input;

  const stakeShare = (() => {
    const total = corp.totalShares;
    if (!ministerCharacterId || !(typeof total === "number") || !(total > 0)) return 0;
    const held = (corp.shareholders ?? [])
      .filter((h) => h.characterId?.toString() === ministerCharacterId.toString())
      .reduce((sum, h) => sum + Math.max(0, h.shares ?? 0), 0);
    return held / total;
  })();

  const isOwner =
    ministerUserId != null &&
    corp.userId != null &&
    corp.userId.toString() === ministerUserId.toString();

  if (isOwner) return { basis: "owner", stakeShare };
  if (stakeShare >= MATERIAL_STAKE_SHARE) return { basis: "shareholding", stakeShare };
  return { basis: null, stakeShare };
}

/**
 * The favorability the awarding minister loses when a self-dealt contract becomes public.
 *
 * Scales with how much of the national contracting tranche the order takes, so signing a
 * token order to a company you own costs almost nothing and routing the quarter's whole
 * procurement budget to yourself is a career event. Capped so one award cannot end a
 * character outright - the consequence is scrutiny, not execution.
 *
 * `tranche` is the window's procurement notional; a non-positive one yields the base penalty
 * rather than dividing by zero.
 */
export const SELF_DEALING_BASE_PENALTY = 1.5;
export const SELF_DEALING_MAX_PENALTY = 8;

export function selfDealingFavorabilityPenalty(input: {
  contractValue: number;
  tranche: number;
}): number {
  const { contractValue, tranche } = input;
  if (!(contractValue > 0)) return 0;
  const share = tranche > 0 ? Math.min(1, contractValue / tranche) : 0;
  const penalty =
    SELF_DEALING_BASE_PENALTY + share * (SELF_DEALING_MAX_PENALTY - SELF_DEALING_BASE_PENALTY);
  return Math.round(Math.min(SELF_DEALING_MAX_PENALTY, penalty) * 10) / 10;
}

/** One line of public disclosure, in the wire's voice rather than an audit log's. */
export function selfDealingDisclosure(input: {
  basis: SelfDealingBasis;
  ministerName: string;
  corporationName: string;
  countryName: string;
  lots: number;
  value: number;
  stakeShare: number;
}): string {
  const interest =
    input.basis === "owner"
      ? `owns ${input.corporationName}`
      : `holds ${(input.stakeShare * 100).toFixed(1)}% of ${input.corporationName}`;
  return (
    `${input.ministerName}, who ${interest}, has awarded the company a ${input.countryName} ` +
    `defence contract for ${input.lots.toLocaleString("en-US")} lots worth ` +
    `${Math.round(input.value).toLocaleString("en-US")}. The award is on the public order book.`
  );
}

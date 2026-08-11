import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import type { ElectoralLawProvision } from "@/lib/db/types/legislation";
import { ELECTORAL_LAW_BILL_CATEGORIES } from "@shared/constants/legislation";

/**
 * Enacted electoral law: the franchise, and how easily voters reach the rolls.
 *
 * Both axes were readable by the engine and writable by nothing. The franchise
 * (`gameState.votingAgeEligible`) has been consulted by the demographic phase
 * since it was written, but no code path ever set it, so it always fell back to
 * the year default and no bill could move it. Registration access had no field
 * at all — the passive Org→Reg drift ran at a fixed rate no law could touch.
 *
 * Both are national, stored on `gameState`, because both are national law in
 * every country the game models.
 */

/** Registration-access axis bounds, matching the union-law bias convention. */
export const REGISTRATION_ACCESS_MIN = -50;
export const REGISTRATION_ACCESS_MAX = 50;

/**
 * Franchise bounds. Wider than the engine's own 16-25 clamp would need, but
 * validated here too so a malformed bill is rejected at enactment rather than
 * silently clamped several phases later.
 */
export const VOTING_AGE_MIN = 16;
export const VOTING_AGE_MAX = 25;

export function clampRegistrationAccess(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(REGISTRATION_ACCESS_MIN, Math.min(REGISTRATION_ACCESS_MAX, value));
}

/** True when `value` is a franchise threshold a bill may legally set. */
export function isValidVotingAge(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= VOTING_AGE_MIN &&
    value <= VOTING_AGE_MAX
  );
}

/**
 * How much the registration-access axis scales passive Reg movement.
 *
 * At the extremes this is a 1.5x swing in either direction: fully restricted
 * registration decays the rolls half again as fast and slows the Org→Reg climb
 * by the same factor; automatic registration does the reverse. Chosen so a
 * landmark electoral law is clearly felt over a few cycles without erasing
 * organization as the thing that actually builds a partisan base — Org is the
 * player's lever, and law should tilt the board, not replace it.
 */
export const REGISTRATION_ACCESS_MAX_SWING = 0.5;

/**
 * Multiplier on the passive Org→Reg drift rate. Expanded access pulls voters
 * onto the rolls faster; restricted access slows the climb.
 */
export function registrationDriftMultiplier(bias: number | undefined): number {
  const b = clampRegistrationAccess(bias ?? 0);
  return 1 + (b / REGISTRATION_ACCESS_MAX) * REGISTRATION_ACCESS_MAX_SWING;
}

/**
 * Multiplier on the passive Reg decay rate. The inverse of the drift
 * multiplier's direction: restricting access makes registrations lapse faster,
 * which is the mechanism roll purges and ID requirements actually operate by.
 */
export function registrationDecayMultiplier(bias: number | undefined): number {
  const b = clampRegistrationAccess(bias ?? 0);
  return 1 - (b / REGISTRATION_ACCESS_MAX) * REGISTRATION_ACCESS_MAX_SWING;
}

/**
 * Apply an enacted `ElectoralLawProvision` to `gameState`.
 *
 * Each axis is independent and optional: a bill that only lowers the voting age
 * leaves registration access exactly as the previous law left it, and vice
 * versa. That matters for repeal round-trips — a later bill touching one axis
 * must not silently reset the other to neutral.
 *
 * Invalid values are dropped rather than clamped-and-applied, so a malformed
 * provision is a no-op instead of quietly enacting a franchise nobody voted for.
 */
export async function applyElectoralLawProvision(
  db: Db,
  provision: ElectoralLawProvision,
  /**
   * The enacting country. Electoral law is NATIONAL law — without this the
   * write lands on a single global field and a Japanese franchise bill sets the
   * American voting age, and a UK registration law scales Brazil's Org→Reg
   * drift. Same per-country shape `incomeBandIndexByCountry` already uses.
   */
  countryId: string
): Promise<{ votingAgeSet?: number; registrationAccessSet?: number }> {
  const update: Record<string, number> = {};
  const applied: { votingAgeSet?: number; registrationAccessSet?: number } = {};
  const cc = countryId.toUpperCase();

  if (provision.votingAge !== undefined && isValidVotingAge(provision.votingAge)) {
    update[`votingAgeEligibleByCountry.${cc}`] = provision.votingAge;
    applied.votingAgeSet = provision.votingAge;
  }
  if (provision.registrationAccess !== undefined) {
    const bias = clampRegistrationAccess(provision.registrationAccess);
    update[`registrationAccessBiasByCountry.${cc}`] = bias;
    applied.registrationAccessSet = bias;
  }

  if (Object.keys(update).length === 0) return applied;

  await db.collection<GameState>("gameState").updateOne({ _id: "current" }, { $set: update });
  return applied;
}

/** One-line player-facing summary of an electoral-law provision, for bill views. */
export function describeElectoralLaw(p: {
  votingAge?: number;
  registrationAccess?: number;
}): string {
  const parts: string[] = [];
  if (p.votingAge !== undefined) parts.push(`Voting age ${p.votingAge}`);
  if (p.registrationAccess !== undefined) {
    parts.push(
      p.registrationAccess > 0
        ? `Registration access: +${p.registrationAccess}`
        : p.registrationAccess < 0
          ? `Registration access: ${p.registrationAccess}`
          : "Registration access: neutral"
    );
  }
  return parts.length > 0 ? parts.join(" · ") : "No change";
}

/**
 * Validate a raw electoral-law provision from a bill proposal.
 *
 * ONE validator, called by both the API route and `billProposal.ts`. The
 * union-law provision has two hand-mirrored copies of its validation and a
 * comment warning they must not drift; this avoids inheriting that problem.
 */
export function validateElectoralLawProvision(
  raw: unknown,
  category: string
): { ok: true; provision: ElectoralLawProvision } | { ok: false; error: string } {
  if (
    !ELECTORAL_LAW_BILL_CATEGORIES.has(
      category as Parameters<typeof ELECTORAL_LAW_BILL_CATEGORIES.has>[0]
    )
  ) {
    return { ok: false, error: "Electoral-law provisions can only be included in social bills." };
  }
  const p = raw as { votingAge?: unknown; registrationAccess?: unknown };

  if (p.votingAge === undefined && p.registrationAccess === undefined) {
    return {
      ok: false,
      error: "An electoral-law provision must set the voting age, registration access, or both.",
    };
  }

  const provision: ElectoralLawProvision = { type: "electoral_law" };

  if (p.votingAge !== undefined) {
    if (!isValidVotingAge(p.votingAge)) {
      return {
        ok: false,
        error: `Voting age must be a whole number between ${VOTING_AGE_MIN} and ${VOTING_AGE_MAX}.`,
      };
    }
    provision.votingAge = p.votingAge;
  }

  if (p.registrationAccess !== undefined) {
    const v = p.registrationAccess;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { ok: false, error: "Registration access must be a number." };
    }
    if (v < REGISTRATION_ACCESS_MIN || v > REGISTRATION_ACCESS_MAX) {
      return {
        ok: false,
        error: `Registration access must be between ${REGISTRATION_ACCESS_MIN} and ${REGISTRATION_ACCESS_MAX}.`,
      };
    }
    provision.registrationAccess = clampRegistrationAccess(v);
  }

  return { ok: true, provision };
}

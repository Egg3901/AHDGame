/**
 * Whether a nation's alignment lets it join an organization, and whether a
 * sitting member still belongs there.
 *
 * Measured on the nation's SHARE in the org's own pole, not on its lead. A share
 * is the direct answer to "how much of this country is ours?", and at 60 in a
 * hundred-point distribution it already implies the nation leads there — so the
 * threshold subsumes any separate "does it lean our way" test, and the
 * Non-Aligned Movement needs no special case: a NAM share of 60 means the same
 * thing a Western share of 60 does.
 *
 * Shared by the join route, the alignment turn phase and the org read model, so
 * the rule that admits a country and the rule that eventually shows it the door
 * can never drift apart.
 */
import { resolveAlignmentEra, type AlignmentPoleId } from "@/lib/constants/alignmentEras";
import type { AlignmentShares } from "./normalize";

/** The one org whose standing is read from the remainder rather than a pole. */
const NON_ALIGNED_ORG_ID = "NON_ALIGNED";

/** Share in an org's pole at or above which a nation may join it. */
export const JOIN_SHARE = 60;
/** Share at or below which a member is on its way out. */
export const LEAVE_SHARE = 40;

/**
 * Turns a nation must hold a threshold before it acts on it — half a game year.
 * Long enough that one bad turn cannot flip a bloc, short enough to resolve
 * inside a play session. Real accessions and defections were slow (Yugoslavia
 * 1948, Albania 1961, Egypt 1972); this is the same shape.
 *
 * Lives here so the turn phase that enforces it and the read model that counts
 * down to it can never disagree about the number.
 */
export const SUSTAIN_TURNS = 24;

export interface AlignmentStanding {
  /** Pole this org channels to, or null for the Non-Aligned Movement. */
  poleId: AlignmentPoleId | null;
  /** The nation's share in THIS org's pole, 0–100. */
  share: number;
  /** At or above {@link JOIN_SHARE} — clear to join. */
  eligible: boolean;
  /** At or below {@link LEAVE_SHARE} — on the way out. */
  wantsOut: boolean;
  /**
   * Whether alignment alone governs membership here. False for orgs with their
   * own membership logic (the Commonwealth's former-empire association, the EU's
   * accession criteria) — those carry influence but are not joined or left on
   * alignment.
   */
  governsMembership: boolean;
}

/**
 * Null when the org has no channel in this era — alignment simply has no opinion
 * about it. Every caller must read null as "no condition", never as
 * "ineligible", or the UN becomes unjoinable.
 *
 * Note `eligible` and `wantsOut` are NOT complements. Between 41 and 59 a nation
 * is neither joining nor leaving: that deadband is deliberate, and it is what
 * stops a member flapping in and out of its bloc on a couple of points of drift.
 */
export function standingFor(params: {
  shares: AlignmentShares;
  year: number;
  organizationId: string;
}): AlignmentStanding | null {
  // The Non-Aligned Movement has no channel and no pole, because non-alignment
  // is not something a bloc pushes for — it is the remainder neither bloc has
  // persuaded. So its "share" is exactly that remainder, and the same 60/40
  // thresholds then mean what they mean everywhere else.
  if (params.organizationId === NON_ALIGNED_ORG_ID) {
    const remainder = params.shares.nonAligned;
    return {
      poleId: null,
      share: remainder,
      eligible: remainder >= JOIN_SHARE,
      wantsOut: remainder <= LEAVE_SHARE,
      governsMembership: true,
    };
  }

  const era = resolveAlignmentEra(params.year);
  const channel = era.channels.find((c) => c.organizationId === params.organizationId);
  if (!channel) return null;

  const share = params.shares.shares[channel.poleId] ?? 0;
  return {
    poleId: channel.poleId,
    share,
    eligible: share >= JOIN_SHARE,
    wantsOut: share <= LEAVE_SHARE,
    // Fail-closed: a channel that has not opted in is not governed by alignment.
    governsMembership: channel.alignmentAccession === true,
  };
}

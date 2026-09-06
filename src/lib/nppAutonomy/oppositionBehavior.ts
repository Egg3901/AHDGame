/**
 * oppositionBehavior — the loyal opposition (V1.7).
 *
 * A government is only a government if it can lose. This gives the largest
 * non-governing party a coordinated stance: its NPPs bloc-vote **against** the
 * governing party's bills (turning rubber-stamp passage into real legislative
 * contention), and — paired with rival-bill sponsorship — it builds its own
 * counter-agenda toward the next election.
 *
 * Pure + deterministic. The bloc-vote force mirrors `computePartyLineForce`'s
 * shape (a compliance-scaled bias on the ideology axis), just with the opposite
 * sign and gated on the bill being a government bill.
 */

import type { NPP } from "@/lib/db/types";
import { complianceMultiplier } from "@/lib/turn/npp/crossPressure";

/**
 * Magnitude of the opposition bloc bias, mirroring `PARTY_LINE_BIAS_BASE`. The
 * opposition opposes government bills about as hard as a party leans for its own.
 */
export const OPPOSITION_BIAS_BASE = 20;

/**
 * Bounds on the difficulty coordination multiplier. The opposition can be made
 * more or less disciplined, never absent and never overwhelming: at the ceiling
 * the bias is 30, still under the ±100 clamp the vote applies and still
 * compliance-scaled, so a low-loyalty maverick can break ranks at any setting.
 */
const MIN_OPPOSITION_COORDINATION = 0.5;
const MAX_OPPOSITION_COORDINATION = 1.5;

export interface OppositionParty {
  partyId: string;
  seats: number;
}

/**
 * The largest party that is not the governing party (the leader of the
 * opposition). Deterministic: ties break on the lower party id. Returns null
 * when there is no non-governing party with seats.
 */
export function identifyOppositionParty(
  seatsByParty: Record<string, number>,
  governingPartyId: string | null
): OppositionParty | null {
  let best: OppositionParty | null = null;
  for (const [partyId, seats] of Object.entries(seatsByParty)) {
    if (partyId === governingPartyId) continue;
    if (seats <= 0) continue;
    if (!best || seats > best.seats || (seats === best.seats && partyId < best.partyId)) {
      best = { partyId, seats };
    }
  }
  return best;
}

/**
 * The against-force an opposition NPP applies when voting on a government bill.
 * Negative = lean against. Zero unless the voter is in the opposition party and
 * the bill is sponsored by the governing party. Compliance-scaled, like the
 * party-line force, so a low-loyalty maverick opposes more weakly.
 */
export function computeOppositionVoteForce(
  npp: NPP,
  params: {
    sponsorParty: string | undefined;
    governingPartyId: string | null;
    oppositionPartyId: string | null;
    /**
     * Difficulty's opposition-discipline multiplier
     * (`NppBehaviorPolicy.oppositionCoordination`). 1 is the shipped bias and is
     * what every hosted/multiplayer world resolves to. Above 1 the opposition
     * holds together better against government bills; below 1 it is easier to
     * peel apart. Clamped here as well as at the policy table, because this is
     * the value that reaches a vote.
     */
    coordination?: number;
  }
): number {
  const { sponsorParty, governingPartyId, oppositionPartyId } = params;
  if (!governingPartyId || !oppositionPartyId) return 0;
  if (npp.party !== oppositionPartyId) return 0;
  if (!sponsorParty || sponsorParty !== governingPartyId) return 0;
  const coordination = Math.max(
    MIN_OPPOSITION_COORDINATION,
    Math.min(MAX_OPPOSITION_COORDINATION, params.coordination ?? 1)
  );
  return -OPPOSITION_BIAS_BASE * coordination * complianceMultiplier(npp);
}

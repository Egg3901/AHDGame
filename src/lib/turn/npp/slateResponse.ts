/**
 * Pure deterministic resolver for `RecruitmentSlate` invitations.
 *
 * NPP slate behavior is relationship-free (see docs/design/party-slate.md): an
 * invited NPP accepts when they are slate-compliant (loyal enough, not too
 * stubborn) and declines otherwise. Incumbents always defend their own seat,
 * and retired / cooldown-blocked NPPs always decline. No randomness — the same
 * inputs always produce the same output, so chairs see exactly how their
 * assignment will land.
 *
 * Side effects (writing back to the SlateCandidate row, marking
 * `respondedAt`, etc.) live in the turn-loop pass that calls this — see
 * `slateResponses.ts`.
 */

import type { NPP, SlateCandidateStatus, SlateRefusalReason } from "@/lib/db/types";
import type { SlateAssignerRole } from "@/lib/slateAuthority";
import { getSlateAcceptanceStatBonus } from "@/lib/slateAuthority";
import { computeSlateAssignmentScore, isNppSlateCompliant } from "@/lib/slateAssignments";

export interface SlateResponseInput {
  npp: NPP;
  assignerRole?: SlateAssignerRole | null;
  /** True if this NPP currently holds the seat the slate is for. */
  isIncumbent: boolean;
  /** Cooldown expiry stamp for this election from `npp.electionCooldowns`. */
  cooldownExpiry: Date | null;
  /** Snapshot of "now" (turn tick). Used to evaluate cooldown. */
  now: Date;
}

export interface SlateResponseOutput {
  status: Extract<SlateCandidateStatus, "accepted" | "declined">;
  refusalReason: SlateRefusalReason | null;
  /** Stable 0-100 compliance score the chair sees on the slate row. */
  fitScore: number;
}

/**
 * Decide how an invited NPP responds. Binary on compliance, matching the
 * invite-time prediction in the slate invitations route. Only immutable
 * blockers (retired, election-specific cooldown) short-circuit before the
 * compliance gate. Incumbents always accept to defend their own seat.
 */
export function decideNPPSlateResponse(input: SlateResponseInput): SlateResponseOutput {
  const { npp, assignerRole = null, isIncumbent, cooldownExpiry, now } = input;

  // Hard declines first — these always trump compliance.
  if (npp.retiredAt) {
    return { status: "declined", refusalReason: "retired", fitScore: 0 };
  }
  if (cooldownExpiry && cooldownExpiry > now) {
    return { status: "declined", refusalReason: "cooldown", fitScore: 0 };
  }

  const fitScore = computeSlateAssignmentScore(npp);

  // Incumbents always accept the slate offer to defend their own seat.
  if (isIncumbent) {
    return { status: "accepted", refusalReason: null, fitScore: Math.max(fitScore, 80) };
  }

  const complianceBonus = getSlateAcceptanceStatBonus(assignerRole);
  if (!isNppSlateCompliant(npp, complianceBonus)) {
    return { status: "declined", refusalReason: "low_compliance", fitScore };
  }

  return { status: "accepted", refusalReason: null, fitScore };
}

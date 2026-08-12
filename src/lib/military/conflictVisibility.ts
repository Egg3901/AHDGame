import type { ConflictDoc, ConflictStatus } from "@/lib/db/types/conflict";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Who may see how much of a conflict.
 *
 * Visibility and ACTIONS are separate axes: a posted general and a defense minister
 * see the same thing and differ only in what they may do (actions stay with
 * `canActAtTheater`). Pure — the page gathers the facts, this decides the tier.
 *
 * Spec: docs/superpowers/specs/2026-07-26-conflict-viewer-tiers-design.md
 */

export type ConflictTier = "public" | "command" | "archive";

export interface ViewerFacts {
  status: ConflictStatus;
  /** The viewer's side by EXPLICIT roster membership; null when not a belligerent. */
  side: "A" | "B" | null;
  isPostedGeneral: boolean;
  isDefenseHolder: boolean;
  isHeadOfGovernment: boolean;
  /**
   * Whether the viewer leads a Command of their own nation.
   *
   * A Commanding General decides which of their generals stand at which front
   * and which one holds the theater — the two decisions that put a nation's
   * forces where they are. Leaving this out gave them the levers and the public
   * record: they could post a general into a battle whose order of battle they
   * were not allowed to see, including their own side's.
   *
   * Command sight, not command AUTHORITY — declaring still runs through
   * `canActAtTheater`, which a Commanding General never satisfies.
   */
  isCommandingGeneral: boolean;
}

/**
 * A country's side by explicit roster membership only.
 *
 * Deliberately NOT `sideOf`, which falls back to a bloc match so battle resolution can
 * decide who an outsider fights for. Reusing that fallback here would hand the UK's
 * defence secretary the US order of battle at any West-backed conflict the UK has no
 * part in.
 */
export function belligerentSideOf(
  c: Pick<ConflictDoc, "sideA" | "sideB">,
  countryId: string
): "A" | "B" | null {
  const id = countryId as CountryId;
  if (c.sideA.countries.includes(id)) return "A";
  if (c.sideB.countries.includes(id)) return "B";
  // A faction IS a belligerent — it is the side, named by its entity id, and a proxy
  // war's rosters start empty. Exact match only: this function is the roster-only one
  // precisely so visibility never inherits `sideOf`'s bloc fallback.
  if (c.sideA.factionEntity === countryId) return "A";
  if (c.sideB.factionEntity === countryId) return "B";
  return null;
}

/**
 * The tier a viewer reads this conflict at. A resolved war is an open record for
 * everyone; otherwise command sight needs BOTH a belligerent country and a SEAT
 * in its command structure.
 *
 * An account flag is not a seat. `isAdmin` used to escalate here, which meant a
 * staff member holding no office in a belligerent nation was handed their own
 * side's full order of battle while the role panel beside it correctly called
 * them a citizen who gives no orders at this front — the page contradicting
 * itself on the one question it exists to answer. Staff oversight of a war, if
 * it is wanted, belongs on an admin surface that says so, not disguised as the
 * public record.
 */
export function conflictTier(f: ViewerFacts): ConflictTier {
  if (f.status === "resolved") return "archive";
  if (f.side === null) return "public";
  const hasSeat =
    f.isPostedGeneral || f.isDefenseHolder || f.isHeadOfGovernment || f.isCommandingGeneral;
  return hasSeat ? "command" : "public";
}

import type { ObjectId } from "mongodb";
import type { AlignmentCountryKey } from "@/lib/constants/alignmentRoster";

/**
 * A flashpoint: one nation put in play for a window, which blocs bid over.
 *
 * While a crisis is open its target's movement ceiling is raised from
 * PER_NATION_TURN_CAP to CRISIS_TURN_CAP, so ordinary plays against that nation
 * go further than they could anywhere else. The crisis pays out nothing itself.
 *
 * Resolved crises are kept rather than deleted, so the desk shows a history
 * rather than a gap.
 */
export interface AlignmentCrisis {
  _id: ObjectId;
  /**
   * Authored world-event kind (`worldEvents.hungarianRising`) or an emergent
   * marker (`emergent.tugOfWar`, `emergent.defection`).
   */
  kind: string;
  targetEntityId: AlignmentCountryKey;
  title: string;
  /** Written to survive retargeting — names the kind of crisis, not the nation. */
  headline: string;
  openedTurn: number;
  closesTurn: number;
  status: "open" | "resolved";
  resolvedTurn: number | null;
  /** Set when an authored crisis had to retarget, for the audit trail. */
  retargetedFrom: string | null;
  createdAt: Date;
}

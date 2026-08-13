import type { Posture } from "@/lib/db/types/militaryUnit";
import { type ConflictAssignment, theaterOfUnit } from "@/lib/military/assignments";
import { postureFloorFor } from "@/lib/military/theaters";

/**
 * The `$set` for assigning a unit to a general (or to General Staff when null).
 * Theater follows the general's posting; Garrison floors to Standard at a front.
 * `posture` is omitted from `$set` when it does not change.
 *
 * Lives here rather than in `assignments.ts` so client imports of that module
 * do not pull `theaters.ts` (and its Mongo helpers) into the browser bundle.
 */
export function assignmentSet(
  assignedGeneralId: string | null,
  assignments: ConflictAssignment[],
  currentPosture: Posture
): { assignedGeneralId: string | null; theaterId: string; posture?: Posture } {
  const theaterId = theaterOfUnit(assignedGeneralId, assignments);
  const posture = postureFloorFor(theaterId, currentPosture);
  return {
    assignedGeneralId,
    theaterId,
    ...(posture !== currentPosture ? { posture } : {}),
  };
}

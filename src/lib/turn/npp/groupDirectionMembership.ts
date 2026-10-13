/** Resolve direction authority once, only for a cohort with an actual NPP direction. */
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import {
  resolveFormalizedGroups,
  type GroupMembership,
} from "@/lib/corporations/groups/groupMembership";
export async function loadGroupDirectionMembership(
  db: Db,
  subsidiariesEnabled: boolean,
  corps: readonly Corporation[],
  preloaded?: GroupMembership
) {
  if (
    !subsidiariesEnabled ||
    !corps.some((c) => c.ceoType === "npp" && !c.caretakerCeo && !!c.groupDirection)
  )
    return undefined;
  return preloaded ?? resolveFormalizedGroups(db, { includeReserved: true });
}

import type { Db, ObjectId } from "mongodb";
import { resolveFormalizedGroups } from "@/lib/corporations/groups/groupMembership";

/** Match the Group page's live ownership and formalization checks, including unsold shares. */
export async function resolveMySubsidiaryGroupNav(
  db: Db,
  corporationId: ObjectId | null,
  subsidiariesEnabled: boolean
): Promise<boolean> {
  if (!subsidiariesEnabled || !corporationId) return false;
  const groups = await resolveFormalizedGroups(db, { includeReserved: true });
  const rootId = groups.rootByCorpId.get(corporationId.toString());
  return !!rootId && (groups.membersByRootId.get(rootId)?.length ?? 0) >= 2;
}

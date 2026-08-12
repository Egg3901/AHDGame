/**
 * Who is in whose group, resolved for every corporation in one pass.
 *
 * `controlledGroupIds` (merger review) answers this for ONE root and scans the
 * corporation set to do it. The turn phase needs every group at once, so this
 * does the same walk once and returns the whole mapping rather than being
 * called in a loop.
 *
 * A group edge requires BOTH halves of the relationship:
 *  - the parent controls >50% of voting power (de facto control), and
 *  - the child is a FORMALIZED subsidiary.
 *
 * De facto control alone is not a group for tax. Formalization is an explicit
 * act the parent already has to take, and making relief depend on it means the
 * same declaration that buys the tax benefit is the one that makes the group
 * legible to merger review and to everyone reading the corporation page.
 */

import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { getControllingCorporateParent } from "@/lib/corporations/corporateOwnership";

export interface GroupMembership {
  /** corpId → the id of the ultimate parent of its group (itself if a root). */
  rootByCorpId: Map<string, string>;
  /** rootId → every member id, including the root. Only groups of 2+. */
  membersByRootId: Map<string, string[]>;
}

type GroupCorpRow = Pick<
  Corporation,
  "_id" | "shareholders" | "totalShares" | "superShareMultiplier" | "subsidiaryFormalizedAtTurn"
>;

/** Resolve every corporate group in the world. */
export async function resolveFormalizedGroups(db: Db): Promise<GroupMembership> {
  const corps = (await db
    .collection<Corporation>("corporations")
    .find(
      {},
      {
        projection: {
          shareholders: 1,
          totalShares: 1,
          superShareMultiplier: 1,
          subsidiaryFormalizedAtTurn: 1,
        },
      }
    )
    .toArray()) as GroupCorpRow[];

  const parentOf = new Map<string, string>();
  for (const corp of corps) {
    // Formalization is the gate. An unformalized corp that someone happens to
    // control is not part of anyone's tax group.
    if (corp.subsidiaryFormalizedAtTurn == null) continue;
    const parent = getControllingCorporateParent(corp as Corporation);
    if (!parent) continue;
    parentOf.set(corp._id.toString(), parent.corporationId.toString());
  }

  const rootByCorpId = new Map<string, string>();
  const resolveRoot = (startId: string): string => {
    // Walk up, bounded by the number of edges, so an ownership cycle that
    // slipped past `cycleGuard` terminates here instead of hanging the turn.
    let current = startId;
    const seen = new Set<string>([current]);
    for (let hops = 0; hops <= parentOf.size; hops++) {
      const next = parentOf.get(current);
      if (!next) return current;
      if (seen.has(next)) {
        // A cycle has no top. Every member must still agree on ONE root or the
        // group fragments into singletons and quietly loses its relief, so
        // canonicalize on the smallest id in the cycle — an arbitrary choice,
        // but the same arbitrary choice from wherever the walk started.
        return [...seen].sort()[0];
      }
      seen.add(next);
      current = next;
    }
    return current;
  };

  for (const corp of corps) {
    const id = corp._id.toString();
    rootByCorpId.set(id, resolveRoot(id));
  }

  const membersByRootId = new Map<string, string[]>();
  for (const [corpId, rootId] of rootByCorpId) {
    const list = membersByRootId.get(rootId);
    if (list) list.push(corpId);
    else membersByRootId.set(rootId, [corpId]);
  }
  // A corporation on its own is not a group.
  for (const [rootId, members] of membersByRootId) {
    if (members.length < 2) membersByRootId.delete(rootId);
  }

  return { rootByCorpId, membersByRootId };
}

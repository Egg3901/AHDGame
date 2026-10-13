/** Formalized controlled subsidiaries resolve to string roots without ambient server dependencies. */
export interface GroupMembership {
  eligibleManagementRoots?: Set<string>;
  rootByCorpId: Map<string, string>;
  membersByRootId: Map<string, string[]>;
}
export interface GroupMembershipRow {
  id: string;
  parentId?: string;
  formalized: boolean;
}
/** Pure resolver for turn snapshots and headless hosts. */
export function resolveMembershipRows(corps: readonly GroupMembershipRow[]): GroupMembership {
  const parentOf = new Map<string, string>();
  for (const corp of corps) {
    // Formalization is the gate. An unformalized corp that someone happens to
    // control is not part of anyone's tax group.
    if (corp.formalized && corp.parentId) parentOf.set(corp.id, corp.parentId);
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
        const chain = [...seen];
        return chain.slice(chain.indexOf(next)).sort()[0];
      }
      seen.add(next);
      current = next;
    }
    return current;
  };

  for (const corp of corps) {
    const id = corp.id;
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

// Groups the flat per-character suspicious-activity list into match clusters
// so accounts flagged against each other render as one card with a compact
// per-account table, instead of N nearly-identical cards (one per member)
// repeating the same evidence in prose. Pure/no I/O — unit-testable, used by
// SuspiciousActivityTab.

export interface SuspiciousFlag {
  type: string;
  severity: "low" | "medium" | "high";
  detail: string;
  detectedAt: string;
  evidence?: Record<string, unknown>;
}

export interface SuspiciousEntry {
  _id: string;
  characterId: string;
  characterName: string;
  userId: string;
  username: string;
  countryId: string;
  flags: SuspiciousFlag[];
  flagCount: number;
  highestSeverity: "low" | "medium" | "high";
  lastUpdated: string;
  dismissed: boolean;
  accountDeleted?: boolean;
  pool?: "active" | "resolved";
}

export interface MatchGroup {
  /** Stable key for React lists — sorted member _ids joined. */
  key: string;
  members: SuspiciousEntry[];
  /** Unique flag types across all members, strong signals first. */
  flagTypes: string[];
  /** True when every flag type across the whole group is IP-only (ip_sharing/login_ip_scatter). */
  isNetworkOnly: boolean;
  highestSeverity: "low" | "medium" | "high";
  lastUpdated: string;
}

// Flag types derived solely from shared/scattered IP addresses. See
// SuspiciousActivityTab.tsx for the full rationale — CGNAT, VPNs, proxy
// edges, and shared networks make these the least reliable signal on their own.
export const NETWORK_ONLY_FLAG_TYPES = new Set(["ip_sharing", "login_ip_scatter"]);

const SEVERITY_RANK: Record<"low" | "medium" | "high", number> = { low: 0, medium: 1, high: 2 };

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/** Every other-account key this entry's flags reference, as union-find node ids. */
function extractPartnerKeys(entry: SuspiciousEntry): string[] {
  const keys: string[] = [];
  for (const flag of entry.flags) {
    const evidence = flag.evidence;
    if (!evidence) continue;

    for (const item of asRecordArray(evidence.sharedWith)) {
      if (typeof item.userId === "string") keys.push(`u:${item.userId}`);
      else if (typeof item.otherUsername === "string") keys.push(`n:${item.otherUsername}`);
    }
    for (const match of asRecordArray(evidence.matches)) {
      if (typeof match.otherUserId === "string") keys.push(`u:${match.otherUserId}`);
      else if (typeof match.otherUsername === "string") keys.push(`n:${match.otherUsername}`);
    }
    if (Array.isArray(evidence.partnerUsernames)) {
      for (const name of evidence.partnerUsernames as unknown[]) {
        if (typeof name === "string") keys.push(`n:${name}`);
      }
    }
  }
  return keys;
}

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

export function buildMatchGroups(entries: SuspiciousEntry[]): MatchGroup[] {
  const uf = new UnionFind();

  for (const entry of entries) {
    const selfKey = `u:${entry.userId}`;
    const aliasKey = `n:${entry.username}`;
    uf.union(selfKey, aliasKey);
    for (const partnerKey of extractPartnerKeys(entry)) {
      uf.union(selfKey, partnerKey);
    }
  }

  const membersByRoot = new Map<string, SuspiciousEntry[]>();
  for (const entry of entries) {
    const root = uf.find(`u:${entry.userId}`);
    const existing = membersByRoot.get(root) ?? [];
    existing.push(entry);
    membersByRoot.set(root, existing);
  }

  const groups: MatchGroup[] = [...membersByRoot.values()].map((rawMembers) => {
    const members = [...rawMembers].sort(
      (a, b) => SEVERITY_RANK[b.highestSeverity] - SEVERITY_RANK[a.highestSeverity]
    );

    const flagTypeSet = new Set<string>();
    for (const member of members) {
      for (const flag of member.flags) flagTypeSet.add(flag.type);
    }
    const flagTypes = [...flagTypeSet].sort((a, b) => {
      const weakA = NETWORK_ONLY_FLAG_TYPES.has(a) ? 1 : 0;
      const weakB = NETWORK_ONLY_FLAG_TYPES.has(b) ? 1 : 0;
      return weakA - weakB;
    });
    const isNetworkOnly =
      flagTypes.length > 0 && flagTypes.every((t) => NETWORK_ONLY_FLAG_TYPES.has(t));

    const highestSeverity = members.reduce<"low" | "medium" | "high">(
      (best, member) =>
        SEVERITY_RANK[member.highestSeverity] > SEVERITY_RANK[best] ? member.highestSeverity : best,
      "low"
    );
    const lastUpdated = members.reduce(
      (max, member) => (member.lastUpdated > max ? member.lastUpdated : max),
      members[0].lastUpdated
    );

    return {
      key: [...members.map((m) => m._id)].sort().join("|"),
      members,
      flagTypes,
      isNetworkOnly,
      highestSeverity,
      lastUpdated,
    };
  });

  return groups.sort((a, b) => {
    const sev = SEVERITY_RANK[b.highestSeverity] - SEVERITY_RANK[a.highestSeverity];
    if (sev !== 0) return sev;
    return b.members.length - a.members.length;
  });
}

import { ObjectId } from "mongodb";
import type {
  AltCluster,
  AltClusterRoles,
  AltClusterSignalSummary,
  AltLink,
  AltSignal,
} from "@/lib/db/types/altDetection";
import { DEFAULT_ALT_SCORING_THRESHOLDS, type AltScoringThresholds } from "./config";

/**
 * Ring clustering (forensics/alt-detection rework plan §3.2, Phase 5 T5.3).
 * Connected components over `altLinks` edges at or above
 * `thresholds.strongLink`, annotated with roles and a rolled-up ring
 * confidence. Weak links remain available as pairwise forensic evidence but
 * cannot transitively join unrelated strong rings into one giant component.
 *
 * Pure: takes an in-memory edge list, returns in-memory clusters. Phase 6
 * upserts the result into `altClusters`.
 */

export interface BuildClustersOptions {
  thresholds?: Partial<AltScoringThresholds>;
  now?: Date;
  turn?: number;
  /** Stable active-iteration key stamped onto materialized matches. */
  iterationKey?: string;
  /** Minimum cluster size to emit — a "ring" of one is not a ring. Default 2. */
  minSize?: number;
  /** Cap on `topEvidence` strings per cluster. Default 5. */
  topEvidenceLimit?: number;
}

const DEFINITIVE_SIGNAL_TYPES = new Set([
  "oauth_shared",
  "device_fingerprint_exact",
  "deviceKey_exact",
  "trackingId_exact",
]);

// ─── Union-find over ObjectId (string-keyed) ────────────────────────────────

class UnionFind {
  private parent = new Map<string, string>();

  find(key: string): string {
    let root = key;
    while (this.parent.has(root) && this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // path compression
    let cursor = key;
    while (this.parent.has(cursor) && this.parent.get(cursor) !== root) {
      const next = this.parent.get(cursor)!;
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    if (!this.parent.has(a)) this.parent.set(a, a);
    if (!this.parent.has(b)) this.parent.set(b, b);
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }

  ensure(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }
}

function objectIdByString(edges: AltLink[]): Map<string, ObjectId> {
  const map = new Map<string, ObjectId>();
  for (const edge of edges) {
    map.set(edge.userA.toString(), edge.userA);
    map.set(edge.userB.toString(), edge.userB);
  }
  return map;
}

/**
 * Ring confidence: mean of "strong" edges (>= `thresholds.strongLink`) when
 * any exist, else the single strongest edge in the cluster (plan §3.2:
 * "strongest-path / mean of strong edges").
 */
function ringConfidence(clusterEdges: AltLink[], strongLink: number): number {
  const strong = clusterEdges.filter((e) => e.confidence >= strongLink);
  const source = strong.length > 0 ? strong : clusterEdges;
  const sum = source.reduce((acc, e) => acc + e.confidence, 0);
  return strong.length > 0
    ? sum / strong.length
    : Math.max(...clusterEdges.map((e) => e.confidence));
}

function buildRoles(
  memberIds: string[],
  clusterEdges: AltLink[],
  strongLink: number
): AltClusterRoles {
  const strongEdges = clusterEdges.filter((e) => e.confidence >= strongLink);

  const strongDegree = new Map<string, number>();
  const definitiveCount = new Map<string, number>();
  for (const id of memberIds) {
    strongDegree.set(id, 0);
    definitiveCount.set(id, 0);
  }
  for (const edge of strongEdges) {
    const a = edge.userA.toString();
    const b = edge.userB.toString();
    strongDegree.set(a, (strongDegree.get(a) ?? 0) + 1);
    strongDegree.set(b, (strongDegree.get(b) ?? 0) + 1);
    const hasDefinitive = edge.signals.some(
      (s) => s.weight > 0 && DEFINITIVE_SIGNAL_TYPES.has(s.type)
    );
    if (hasDefinitive) {
      definitiveCount.set(a, (definitiveCount.get(a) ?? 0) + 1);
      definitiveCount.set(b, (definitiveCount.get(b) ?? 0) + 1);
    }
  }

  if (strongEdges.length === 0) {
    // No strong edges at all — nobody is a confirmed operator/burner; every
    // member stays a circumstantial associate (jbm's own account had a null
    // fingerprint, so an operator link can legitimately stay circumstantial).
    return { burners: [], associates: memberIds.map(toObjectIdRef(clusterEdges)) };
  }

  let operatorId = memberIds[0];
  for (const id of memberIds) {
    const deg = strongDegree.get(id) ?? 0;
    const bestDeg = strongDegree.get(operatorId) ?? 0;
    if (
      deg > bestDeg ||
      (deg === bestDeg &&
        (definitiveCount.get(id) ?? 0) > (definitiveCount.get(operatorId) ?? 0)) ||
      (deg === bestDeg &&
        (definitiveCount.get(id) ?? 0) === (definitiveCount.get(operatorId) ?? 0) &&
        id < operatorId)
    ) {
      operatorId = id;
    }
  }

  const operatorHasStrongEdge = (strongDegree.get(operatorId) ?? 0) > 0;
  if (!operatorHasStrongEdge) {
    return { burners: [], associates: memberIds.map(toObjectIdRef(clusterEdges)) };
  }

  const burnerIds = new Set<string>();
  for (const edge of strongEdges) {
    const a = edge.userA.toString();
    const b = edge.userB.toString();
    if (a === operatorId) burnerIds.add(b);
    else if (b === operatorId) burnerIds.add(a);
  }

  const toRef = toObjectIdRef(clusterEdges);
  const associateIds = memberIds.filter((id) => id !== operatorId && !burnerIds.has(id));

  return {
    operator: toRef(operatorId),
    burners: [...burnerIds].map(toRef),
    associates: associateIds.map(toRef),
  };
}

function toObjectIdRef(edges: AltLink[]): (idStr: string) => ObjectId {
  const map = objectIdByString(edges);
  return (idStr: string) => {
    const found = map.get(idStr);
    if (!found) throw new Error(`buildAltClusters: unresolved member id ${idStr}`);
    return found;
  };
}

function buildSignalSummary(clusterEdges: AltLink[]): AltClusterSignalSummary[] {
  const byType = new Map<AltSignal, { count: number; maxContribution: number }>();
  for (const edge of clusterEdges) {
    for (const signal of edge.signals) {
      if (signal.weight <= 0) continue; // guarded-to-zero signals aren't cluster evidence
      const existing = byType.get(signal.type) ?? { count: 0, maxContribution: 0 };
      existing.count += 1;
      existing.maxContribution = Math.max(existing.maxContribution, signal.contribution);
      byType.set(signal.type, existing);
    }
  }
  return [...byType.entries()]
    .map(([type, agg]) => ({ type, count: agg.count, maxContribution: agg.maxContribution }))
    .sort((a, b) => b.maxContribution - a.maxContribution);
}

function buildTopEvidence(clusterEdges: AltLink[], limit: number): string[] {
  const all = clusterEdges
    .flatMap((edge) => edge.signals)
    .filter((s) => s.weight > 0)
    .sort((a, b) => b.contribution - a.contribution);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const signal of all) {
    if (seen.has(signal.evidence)) continue;
    seen.add(signal.evidence);
    result.push(signal.evidence);
    if (result.length >= limit) break;
  }
  return result;
}

export function buildAltClusters(
  links: AltLink[],
  options: BuildClustersOptions = {}
): AltCluster[] {
  const thresholds: AltScoringThresholds = {
    ...DEFAULT_ALT_SCORING_THRESHOLDS,
    ...options.thresholds,
  };
  const now = options.now ?? new Date();
  const turn = options.turn ?? 0;
  const minSize = options.minSize ?? 2;
  const topEvidenceLimit = options.topEvidenceLimit ?? 5;

  // A reviewable ring must be connected by strong aggregate evidence. Using
  // the lower pair-link threshold here lets a single weak behavioral/network
  // edge bridge otherwise unrelated rings, and connected-components then
  // labels every account in the transitive chain as one cluster.
  const clusterEdgeThreshold = Math.max(thresholds.link, thresholds.strongLink);
  const qualifyingEdges = links.filter((edge) => edge.confidence >= clusterEdgeThreshold);
  if (qualifyingEdges.length === 0) return [];

  const uf = new UnionFind();
  for (const edge of qualifyingEdges) {
    const a = edge.userA.toString();
    const b = edge.userB.toString();
    uf.ensure(a);
    uf.ensure(b);
    uf.union(a, b);
  }

  const componentMembers = new Map<string, Set<string>>();
  const allMemberIds = new Set<string>();
  for (const edge of qualifyingEdges) {
    allMemberIds.add(edge.userA.toString());
    allMemberIds.add(edge.userB.toString());
  }
  for (const id of allMemberIds) {
    const root = uf.find(id);
    const set = componentMembers.get(root) ?? new Set<string>();
    set.add(id);
    componentMembers.set(root, set);
  }

  const edgesByRoot = new Map<string, AltLink[]>();
  for (const edge of qualifyingEdges) {
    const root = uf.find(edge.userA.toString());
    const arr = edgesByRoot.get(root) ?? [];
    arr.push(edge);
    edgesByRoot.set(root, arr);
  }

  const clusters: AltCluster[] = [];
  for (const [root, members] of componentMembers) {
    if (members.size < minSize) continue;
    const memberIds = [...members].sort();
    const clusterEdges = edgesByRoot.get(root) ?? [];
    const toRef = toObjectIdRef(clusterEdges);

    clusters.push({
      // Fresh id per computed snapshot; Phase 6's upsert reconciles against
      // any existing `altClusters` doc for this member set (e.g. by
      // `memberUserIds` match) rather than relying on this value directly.
      _id: new ObjectId(),
      memberUserIds: memberIds.map(toRef),
      confidence: ringConfidence(clusterEdges, thresholds.strongLink),
      size: memberIds.length,
      signalSummary: buildSignalSummary(clusterEdges),
      roles: buildRoles(memberIds, clusterEdges, thresholds.strongLink),
      topEvidence: buildTopEvidence(clusterEdges, topEvidenceLimit),
      status: "open",
      updatedAt: now,
      turn,
      ...(options.iterationKey ? { iterationKey: options.iterationKey } : {}),
    });
  }

  return clusters.sort((a, b) => b.confidence - a.confidence);
}

export type OwnerKind = "character" | "imperial" | "corporation" | "npp" | "fund";

export interface OwnershipPosition {
  key: string;
  shares: number;
}

export interface OwnershipSnapshot {
  turn: number;
  totalShares: number;
  /** Null means the register was not recorded, not that every holder exited. */
  holders: OwnershipPosition[] | null;
  publicFloat: number | null;
}

export interface OwnershipOwner {
  key: string;
  kind: OwnerKind;
  name: string;
}

export interface OwnershipHistory {
  snapshots: OwnershipSnapshot[];
  owners: OwnershipOwner[];
}

export function ownershipKey(kind: OwnerKind, id: string): string {
  return `${kind}:${id}`;
}

export function ownershipPercent(shares: number, totalShares: number): number {
  return totalShares > 0 ? (shares / totalShares) * 100 : 0;
}

export function sharesAt(snapshot: OwnershipSnapshot, key: string): number | null {
  if (key === "public_float") return snapshot.publicFloat;
  if (snapshot.holders === null) return null;
  return snapshot.holders.reduce((sum, h) => sum + (h.key === key ? h.shares : 0), 0);
}

/** One point per turn keeps missing snapshots visible as gaps in the chart. */
export function ownershipSeries(snapshots: OwnershipSnapshot[], key: string) {
  if (snapshots.length === 0) return [];
  const ordered = [...snapshots].sort((a, b) => a.turn - b.turn);
  const byTurn = new Map(ordered.map((snapshot) => [snapshot.turn, snapshot]));
  const first = ordered[0].turn;
  const last = ordered[ordered.length - 1].turn;
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const turn = first + index;
    const snapshot = byTurn.get(turn);
    const shares = snapshot ? sharesAt(snapshot, key) : null;
    return {
      turn,
      shares,
      percent:
        snapshot && snapshot.totalShares > 0 && shares !== null
          ? ownershipPercent(shares, snapshot.totalShares)
          : null,
    };
  });
}

/** Compare recorded endpoints using each endpoint's own issued share count. */
export function ownershipChanges(snapshots: OwnershipSnapshot[]) {
  const recorded = snapshots
    .filter((s) => s.holders !== null && s.totalShares > 0)
    .sort((a, b) => a.turn - b.turn);
  if (recorded.length < 2) return null;
  const first = recorded[0];
  const last = recorded[recorded.length - 1];
  const keys = new Set([...first.holders!, ...last.holders!].map((h) => h.key));
  const changes = [...keys]
    .map((key) => {
      const before = sharesAt(first, key)!;
      const after = sharesAt(last, key)!;
      return {
        key,
        before,
        after,
        beforePercent: ownershipPercent(before, first.totalShares),
        afterPercent: ownershipPercent(after, last.totalShares),
        change:
          ownershipPercent(after, last.totalShares) - ownershipPercent(before, first.totalShares),
      };
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.key.localeCompare(b.key));
  return { firstTurn: first.turn, lastTurn: last.turn, changes };
}

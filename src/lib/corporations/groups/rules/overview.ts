import { combineGroupLatest } from "./financialHistory";
type Point = NonNullable<ReturnType<typeof combineGroupLatest>>;
/** Complete observations for today's member set; missing/private snapshots never become zeros. */
export function groupOverviewHistory(
  histories: readonly (readonly Point[] | null)[],
  currentTurn: number,
  lookback: 12 | 24 | 48
) {
  const byTurn = histories.map((rows) => new Map((rows ?? []).map((r) => [r.turn, r])));
  const latest = combineGroupLatest(histories.map((rows) => rows?.[0]));
  const points: Point[] = [];
  for (let turn = Math.max(0, currentTurn - lookback + 1); turn <= currentTurn; turn++) {
    const combined = combineGroupLatest(byTurn.map((rows) => rows.get(turn)));
    if (combined) points.push(combined);
  }
  // The shared chart spaces points equally. Never connect through an unobserved turn.
  const consecutive: Point[] = [];
  for (const point of points) {
    if (consecutive.length && point.turn !== consecutive[consecutive.length - 1].turn + 1)
      consecutive.length = 0;
    consecutive.push(point);
  }
  const revenue = latest?.revenue;
  return {
    latest,
    points,
    consecutive,
    margin: revenue != null && revenue > 0 ? (latest!.income / revenue) * 100 : null,
    contributions:
      latest && latest.revenue > 0 && histories.every((rows) => rows && rows[0].revenue >= 0)
        ? histories.map((rows) => (rows![0].revenue / latest.revenue) * 100)
        : null,
  };
}
/** Count known operating regions once per country/state, across and within members. */
export function groupRegionFootprint(
  rows: readonly { corporationId: string; countryId?: string; stateId?: string }[]
) {
  const all = new Set<string>();
  const byMember = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.countryId || !row.stateId) continue;
    const key = JSON.stringify([row.countryId, row.stateId]);
    all.add(key);
    const member = byMember.get(row.corporationId) ?? new Set<string>();
    member.add(key);
    byMember.set(row.corporationId, member);
  }
  return {
    total: all.size,
    byMember: new Map([...byMember].map(([id, regions]) => [id, regions.size])),
  };
}

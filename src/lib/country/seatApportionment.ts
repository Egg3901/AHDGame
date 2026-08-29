/**
 * Rescale one chamber's party shares onto another chamber's size.
 *
 * The Volkskammer seats 500; the five eastern Laender's Bundestag allocation is
 * 48. Carrying `seatsHeld` across unchanged would hand the merged chamber ten
 * times its own size, so the shares are what travel, not the counts.
 *
 * LARGEST REMAINDER rather than round-then-fix: rounding each share
 * independently does not sum to the target, and any repair pass has to pick
 * someone to adjust anyway. Largest remainder makes that choice the principled
 * one and is what every other apportionment in this codebase means by "share".
 *
 * Ties break by ascending key so a re-run apportions identically -- the merge is
 * re-runnable after a partial failure, and an apportionment that drifted between
 * runs would hand out different chambers on each attempt.
 *
 * Spec: docs/superpowers/specs/2026-08-29-reunification-merge-design.md
 */
export function apportionSeats(
  sourceSeatsByParty: Record<string, number>,
  targetTotal: number
): Record<string, number> {
  const keys = Object.keys(sourceSeatsByParty).sort();
  if (keys.length === 0) return {};

  const sourceTotal = keys.reduce((sum, k) => sum + Math.max(0, sourceSeatsByParty[k]), 0);
  const out: Record<string, number> = {};
  // A source chamber holding no seats has no shares to scale. Zero for everyone is
  // the honest answer; spreading the target evenly would invent a result.
  if (sourceTotal <= 0 || targetTotal <= 0) {
    for (const k of keys) out[k] = 0;
    return out;
  }

  const exact = keys.map((k) => ({
    key: k,
    quota: (Math.max(0, sourceSeatsByParty[k]) / sourceTotal) * targetTotal,
  }));

  let assigned = 0;
  for (const e of exact) {
    const floor = Math.floor(e.quota);
    out[e.key] = floor;
    assigned += floor;
  }

  // Hand the leftover seats to the largest fractional remainders, ascending key
  // on a tie. A party whose quota floors to zero can still take a remainder seat,
  // which is what makes this proportional rather than a threshold.
  const remaining = targetTotal - assigned;
  const byRemainder = [...exact].sort((a, b) => {
    const ra = a.quota - Math.floor(a.quota);
    const rb = b.quota - Math.floor(b.quota);
    if (rb !== ra) return rb - ra;
    return a.key < b.key ? -1 : 1;
  });
  for (let i = 0; i < remaining; i++) {
    out[byRemainder[i % byRemainder.length].key] += 1;
  }

  return out;
}

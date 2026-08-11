/** Union of turns across series, sorted ascending */
export function collectTurns(histories: { turn: number; value: number }[][]): number[] {
  const s = new Set<number>();
  for (const h of histories) {
    for (const p of h) s.add(p.turn);
  }
  return [...s].sort((a, b) => a - b);
}

/**
 * Align one series onto `turns` using last-known value per turn (forward fill).
 */
export function alignSeries(series: { turn: number; value: number }[], turns: number[]): number[] {
  const sorted = [...series].sort((a, b) => a.turn - b.turn);
  let i = 0;
  let last: number | undefined;
  const raw: (number | undefined)[] = [];
  for (const t of turns) {
    while (i < sorted.length && sorted[i]!.turn <= t) {
      last = sorted[i]!.value;
      i++;
    }
    raw.push(last);
  }
  const firstIdx = raw.findIndex((v) => v !== undefined);
  if (firstIdx === -1) return turns.map(() => 0);
  const firstVal = raw[firstIdx]!;
  for (let j = 0; j < firstIdx; j++) raw[j] = firstVal;
  for (let j = 0; j < raw.length; j++) {
    if (raw[j] === undefined) raw[j] = raw[j - 1] ?? firstVal;
  }
  return raw as number[];
}

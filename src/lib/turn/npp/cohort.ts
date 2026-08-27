/** Spread corporation state changes across turns to avoid supply cliffs. */
export const GLUT_STATE_CHANGE_STAGGER = 8;

/** Deterministic per-corporation turn slot. */
export function glutStaggerEligible(corpId: string, turn: number): boolean {
  const tail = parseInt(corpId.slice(-6), 16);
  const hash = Number.isFinite(tail) ? tail : 0;
  return (hash + turn) % GLUT_STATE_CHANGE_STAGGER === 0;
}

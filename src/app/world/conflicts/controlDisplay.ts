const TOTAL_BASIS_POINTS = 10_000;

function displayBasisPoints(control: number): number {
  const bounded = Math.max(0, Math.min(100, control));
  const rounded = Math.round(bounded * 100);

  if (bounded > 0 && rounded === 0) return 1;
  if (bounded < 100 && rounded === TOTAL_BASIS_POINTS) return TOTAL_BASIS_POINTS - 1;
  return rounded;
}

/**
 * Format side B's persisted control and side A's remainder as one exact 100.00% split.
 * Non-pole values stay visibly short of 0% and 100%, where conflict resolution occurs.
 */
export function controlSplitDisplay(control: number): { sideA: string; sideB: string } {
  const sideBBasisPoints = displayBasisPoints(control);
  const sideABasisPoints = TOTAL_BASIS_POINTS - sideBBasisPoints;

  return {
    sideA: (sideABasisPoints / 100).toFixed(2),
    sideB: (sideBBasisPoints / 100).toFixed(2),
  };
}

/** Portable bounded recentering and turnout rules for a frozen electorate. */
export function recenterLeans(
  cohorts: Array<{ share: number; turnout: number; yesLean: number }>,
  target: number
): number[] {
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  const total = cohorts.reduce((sum, c) => sum + c.share * c.turnout, 0);
  if (total <= 0) return cohorts.map(() => clamp(target));
  let lo = -100;
  let hi = 100;
  for (let i = 0; i < 60; i++) {
    const offset = (lo + hi) / 2;
    const value =
      cohorts.reduce((sum, c) => sum + c.share * c.turnout * clamp(c.yesLean + offset), 0) / total;
    if (value < clamp(target)) lo = offset;
    else hi = offset;
  }
  return cohorts.map((c) => clamp(c.yesLean + (lo + hi) / 2));
}

export function cohortTurnout(
  cohorts: Array<{ share: number; turnout: number; groupId: string }>,
  modifiers: Array<{ groupId: string; turnoutMod: number }>,
  cap: number
): number {
  const shares = cohorts.reduce((sum, c) => sum + c.share, 0);
  if (shares <= 0) return 0;
  const byId = new Map(modifiers.map((m) => [m.groupId, m.turnoutMod]));
  return (
    cohorts.reduce(
      (sum, c) =>
        sum +
        c.share *
          Math.max(0, Math.min(100, c.turnout + cap * Math.tanh((byId.get(c.groupId) ?? 0) / cap))),
      0
    ) / shares
  );
}

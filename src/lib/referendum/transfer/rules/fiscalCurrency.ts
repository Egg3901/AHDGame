/** Fiscal transfers remove source-currency amounts and add their exact FX equivalent. */
export function shiftNumericMap(
  from: Record<string, number> | undefined,
  to: Record<string, number> | undefined,
  weight: number,
  scale = 1
) {
  const kept = { ...(from ?? {}) };
  const moved = { ...(to ?? {}) };
  for (const [key, value] of Object.entries(kept)) {
    if (!Number.isFinite(value)) continue;
    const amount = value * weight;
    kept[key] = value - amount;
    moved[key] = (moved[key] ?? 0) + amount * scale;
  }
  return { from: kept, to: moved };
}

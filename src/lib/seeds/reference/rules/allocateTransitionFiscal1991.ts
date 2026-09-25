/** Split an authored total into scenario spending lines while preserving the total. */
export function allocateTransitionFiscal1991(
  total: number,
  shares: Readonly<Record<string, number>>
): Record<string, number> {
  const entries = Object.entries(shares);
  if (!Number.isFinite(total) || total < 0 || entries.length === 0) {
    throw new Error("Invalid transition fiscal total");
  }
  const shareTotal = entries.reduce((sum, [, share]) => sum + share, 0);
  if (Math.abs(shareTotal - 1) > 1e-8 || entries.some(([, share]) => share < 0)) {
    throw new Error("Transition fiscal shares must sum to one");
  }
  const allocations = Object.fromEntries(
    entries.map(([key, share]) => [key, Math.floor(total * share)])
  );
  const allocated = Object.values(allocations).reduce((sum, value) => sum + value, 0);
  allocations[entries[entries.length - 1][0]] += Math.round(total) - allocated;
  return allocations;
}

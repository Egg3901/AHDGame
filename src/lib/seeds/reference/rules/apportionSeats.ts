/** Hamilton apportionment with stable input order as the tie-breaker. */
export function apportionSeats(
  totalSeats: number,
  populationByRegion: Readonly<Record<string, number>>
): Record<string, number> {
  const entries = Object.entries(populationByRegion);
  if (!Number.isInteger(totalSeats) || totalSeats < 0 || entries.length === 0) {
    throw new Error("Seat apportionment requires nonnegative seats and regions");
  }
  const totalPopulation = entries.reduce((sum, [id, population]) => {
    if (!Number.isFinite(population) || population <= 0) {
      throw new Error(`Missing positive population for ${id}`);
    }
    return sum + population;
  }, 0);
  const rows = entries.map(([id, population], order) => {
    const quota = (totalSeats * population) / totalPopulation;
    return { id, order, seats: Math.floor(quota), remainder: quota % 1 };
  });
  const remaining = totalSeats - rows.reduce((sum, row) => sum + row.seats, 0);
  for (const row of [...rows]
    .sort((a, b) => b.remainder - a.remainder || a.order - b.order)
    .slice(0, remaining)) {
    row.seats++;
  }
  return Object.fromEntries(rows.map(({ id, seats }) => [id, seats]));
}

/**
 * Russian direct votes use the existing campaign-strength curve within a fixed pool.
 * russianPresidentialVoteIncrement redistributes this turn's votes by campaign
 * strength and prevents cumulative participation exceeding the frozen register.
 */
import { campaignStrengthVoteMultiplier } from "@/lib/campaigns/campaignStrength";

export function russianPresidentialVoteIncrement(input: {
  registeredVoters: number;
  priorVotes: Readonly<Record<string, number>>;
  rawVotes: Readonly<Record<string, number>>;
  campaignStrength: Readonly<Record<string, number>>;
}): Record<string, number> {
  const validCount = (value: number) => Number.isSafeInteger(value) && value >= 0;
  if (
    !validCount(input.registeredVoters) ||
    Object.values(input.priorVotes).some((v) => !validCount(v))
  )
    throw new Error("Russian participation needs safe registered and prior vote counts");
  const prior = Object.values(input.priorVotes).reduce((sum, n) => sum + n, 0);
  if (!validCount(prior) || prior > input.registeredVoters)
    throw new Error("Russian prior participation exceeds the frozen register");
  const rows = Object.entries(input.rawVotes).map(([id, raw]) => {
    const strength = input.campaignStrength[id] ?? 0;
    if (!validCount(raw) || !Number.isFinite(strength) || strength < 0)
      throw new Error("Russian direct vote weights must be finite and nonnegative");
    return {
      id,
      raw,
      weight:
        BigInt(raw) * BigInt(Math.round(campaignStrengthVoteMultiplier(strength) * 1_000_000)),
    };
  });
  const rawTotal = rows.reduce((sum, row) => sum + row.raw, 0);
  const weightTotal = rows.reduce((sum, row) => sum + row.weight, BigInt(0));
  if (!Number.isFinite(rawTotal) || rawTotal > Number.MAX_SAFE_INTEGER)
    throw new Error("Russian direct vote totals exceed precision");
  const target = Math.min(Math.round(rawTotal), input.registeredVoters - prior);
  if (weightTotal === BigInt(0) || target === 0)
    return Object.fromEntries(rows.map((row) => [row.id, 0]));
  const quotas = rows.map((row) => {
    const numerator = row.weight * BigInt(target);
    return {
      id: row.id,
      seats: Number(numerator / weightTotal),
      fraction: numerator % weightTotal,
    };
  });
  const remainder = target - quotas.reduce((sum, row) => sum + row.seats, 0);
  quotas.sort((a, b) =>
    a.fraction === b.fraction ? a.id.localeCompare(b.id) : a.fraction > b.fraction ? -1 : 1
  );
  for (let i = 0; i < remainder; i++) quotas[i].seats++;
  return Object.fromEntries(quotas.map((row) => [row.id, row.seats]));
}

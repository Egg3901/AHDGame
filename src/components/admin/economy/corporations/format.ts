export function fmt(n: number) {
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

/** 48 game turns = 1 game year in simulation. */
export function formatImfPayoffTurns(estimated: number | null, facilityPrincipal: number): string {
  if (facilityPrincipal <= 0) return "N/A (no facility principal)";
  if (estimated === null) return "Not within safeguard (see warning)";
  if (estimated === 0) return "0 (already clear)";
  const gameYears = estimated / 48;
  return `${estimated} turns (~${gameYears.toFixed(1)} game years)`;
}

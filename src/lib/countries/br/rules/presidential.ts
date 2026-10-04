/** Congressional ballots have no popular-vote accumulation. */
export function isBrazilIndirectPresidentialElection(
  election: {
    countryId?: string;
    electionType: string;
    brazilPresidentialMode?: "plurality" | "indirect" | "majority";
  },
  preset?: string
): boolean {
  return (
    election.countryId === "BR" &&
    election.electionType === "president" &&
    (election.brazilPresidentialMode === "indirect" ||
      (!election.brazilPresidentialMode && preset === "1979-default"))
  );
}

/** Brazil renews the presidency through the era's selection system. */
export function brazilPresidentialRules(preset: string): {
  firstYear: number;
  termTurns: number;
  mode: "plurality" | "indirect" | "majority";
} {
  switch (preset) {
    case "1953-default":
      return { firstYear: 1955, termTurns: 240, mode: "plurality" };
    case "1979-default":
      return { firstYear: 1985, termTurns: 288, mode: "indirect" };
    case "1991-default":
      return { firstYear: 1994, termTurns: 192, mode: "majority" };
    case "1999-default":
      return { firstYear: 2002, termTurns: 192, mode: "majority" };
    case "2007-default":
      return { firstYear: 2010, termTurns: 192, mode: "majority" };
    case "2019-default":
    case "2019-no-parties":
      return { firstYear: 2022, termTurns: 192, mode: "majority" };
    case "2023-default":
      return { firstYear: 2026, termTurns: 192, mode: "majority" };
    case "2027-default":
      return { firstYear: 2030, termTurns: 192, mode: "majority" };
    default:
      throw new Error(`Unsupported Brazil presidential preset: ${preset}`);
  }
}

export type BrazilPresidentialDecision =
  | { outcome: "won"; winnerId: string }
  | { outcome: "runoff"; finalistIds: [string, string] }
  | { outcome: "indeterminate" };
export function decideBrazilPresidency(
  votes: Record<string, number>,
  mode: "plurality" | "indirect" | "majority",
  round: number
): BrazilPresidentialDecision {
  const ranked = Object.entries(votes)
    .filter(([, n]) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = ranked.reduce((sum, [, n]) => sum + n, 0);
  if (!ranked.length || total <= 0) return { outcome: "indeterminate" };
  if (mode !== "majority" || round === 2 || ranked[0][1] > total / 2)
    return { outcome: "won", winnerId: ranked[0][0] };
  if (ranked.length < 2) return { outcome: "indeterminate" };
  return { outcome: "runoff", finalistIds: [ranked[0][0], ranked[1][0]] };
}

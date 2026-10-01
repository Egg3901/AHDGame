/** Election turnover compares like-for-like resolved cycles and exposes missing historical evidence. */
export type ActorMix = "npp-only" | "player-only" | "mixed" | "unknown";
export interface TurnoverCycle {
  id: string;
  countryId: string;
  family: string;
  scope: string;
  outcomeScope: string;
  cycle: number;
  resolvedTurn: number | null;
  seats: Record<string, number> | null;
  people: string[] | null;
  winningActors: ("player" | "npp")[] | null;
  actorMix: ActorMix;
  resolutionPath: string | null;
  missing: string[];
}
export interface CycleRate {
  count: number;
  comparableCycles: number;
  per100: number | null;
}
const rate = (count: number, comparableCycles: number): CycleRate => ({
  count,
  comparableCycles,
  per100: comparableCycles > 0 ? (count * 100) / comparableCycles : null,
});
const normalized = (seats: Record<string, number>) =>
  Object.entries(seats)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b));
const sum = (seats: Record<string, number>) => Object.values(seats).reduce((a, b) => a + b, 0);
const same = (a: string[], b: string[]) =>
  JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
function leader(seats: Record<string, number>): string | null {
  const entries = normalized(seats),
    max = Math.max(0, ...entries.map(([, n]) => n));
  const leaders = entries.filter(([, n]) => n === max);
  return leaders.length === 1 ? leaders[0][0] : null;
}
export function summarizeElectionTurnover(input: readonly TurnoverCycle[]) {
  const groups = new Map<string, TurnoverCycle[]>();
  for (const row of input) {
    const key = `${row.countryId}:${row.family}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => {
      const scopes = new Map<string, TurnoverCycle[]>();
      for (const row of rows) scopes.set(row.scope, [...(scopes.get(row.scope) ?? []), row]);
      let possible = 0,
        comparable = 0,
        changed = 0,
        tied = 0,
        unique = 0,
        flips = 0,
        personPairs = 0,
        replaced = 0,
        fullHolds = 0,
        someRetained = 0;
      const exclusions: Record<string, number> = {};
      for (const races of scopes.values()) {
        races.sort(
          (a, b) =>
            a.cycle - b.cycle ||
            (a.resolvedTurn ?? 0) - (b.resolvedTurn ?? 0) ||
            a.id.localeCompare(b.id)
        );
        const cycleCounts = new Map<number, number>();
        for (const race of races)
          cycleCounts.set(race.cycle, (cycleCounts.get(race.cycle) ?? 0) + 1);
        for (let i = 1; i < races.length; i++) {
          possible++;
          const previous = races[i - 1],
            current = races[i];
          const reason =
            cycleCounts.get(previous.cycle)! > 1 || cycleCounts.get(current.cycle)! > 1
              ? "ambiguous duplicate cycle"
              : !previous.seats || !current.seats
                ? "missing stored outcome"
                : sum(previous.seats) !== sum(current.seats)
                  ? "changed seat capacity"
                  : null;
          if (reason) {
            exclusions[reason] = (exclusions[reason] ?? 0) + 1;
            continue;
          }
          comparable++;
          if (
            JSON.stringify(normalized(previous.seats!)) !==
            JSON.stringify(normalized(current.seats!))
          )
            changed++;
          const before = leader(previous.seats!),
            after = leader(current.seats!);
          if (before === null || after === null) tied++;
          else {
            unique++;
            if (before !== after) flips++;
          }
          if (previous.people && current.people) {
            personPairs++;
            if (same(previous.people, current.people)) fullHolds++;
            else replaced++;
            if (previous.people.some((person) => current.people!.includes(person))) someRetained++;
          }
        }
      }
      const knownActors = rows.filter((row) => row.winningActors !== null);
      const methods: Record<string, number> = {};
      const missing: Record<string, number> = {};
      for (const row of rows) {
        const path = row.resolutionPath ?? "unknown";
        methods[path] = (methods[path] ?? 0) + 1;
        for (const reason of row.missing) missing[reason] = (missing[reason] ?? 0) + 1;
      }
      return {
        key,
        countryId: rows[0].countryId,
        electionFamily: rows[0].family,
        resolvedCycles: rows.length,
        possibleComparisons: possible,
        comparableCycles: comparable,
        excludedComparisons: exclusions,
        partySeatVectorChange: rate(changed, comparable),
        unchangedPartySeatVector: rate(comparable - changed, comparable),
        uniqueControlFlips: rate(flips, unique),
        uniqueControlHolds: rate(unique - flips, unique),
        tiedControlComparison: rate(tied, comparable),
        tiedControlCycles: rate(
          rows.filter((row) => row.seats !== null && leader(row.seats) === null).length,
          rows.filter((row) => row.seats !== null).length
        ),
        personReplacement: rate(replaced, personPairs),
        completeIncumbentHold: rate(fullHolds, personPairs),
        anyIncumbentRetained: rate(someRetained, personPairs),
        playerWinCycles: rate(
          knownActors.filter((row) => row.winningActors!.includes("player")).length,
          knownActors.length
        ),
        nppWinCycles: rate(
          knownActors.filter((row) => row.winningActors!.includes("npp")).length,
          knownActors.length
        ),
        outcomeScopes: Object.fromEntries(
          [...new Set(rows.map((row) => row.outcomeScope))]
            .sort()
            .map((scope) => [scope, rows.filter((row) => row.outcomeScope === scope).length])
        ),
        actorMix: Object.fromEntries(
          (["npp-only", "player-only", "mixed", "unknown"] as const).map((mix) => [
            mix,
            rows.filter((row) => row.actorMix === mix).length,
          ])
        ),
        resolverPathShares: Object.fromEntries(
          Object.entries(methods)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([path, count]) => [path, rate(count, rows.length)])
        ),
        missingEvidence: missing,
        unknownPersonComparisonCount: comparable - personPairs,
        unknownWinnerActorCycles: rows.length - knownActors.length,
      };
    });
}

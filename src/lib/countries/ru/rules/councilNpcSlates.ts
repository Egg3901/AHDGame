/**
 * Council party slates nominate up to two bounded individuals in each subject.
 * planRussianCouncilNpcSlates preserves player entries and excludes profiles
 * reserved for the Duma, reusing existing financial identities without cloning them.
 */
export interface RussianCouncilNpcSlateInput {
  ballots: readonly { id: string; regionId: string }[];
  parties: readonly string[];
  profiles: readonly { id: string; party: string; homeState: string; eligible: boolean }[];
  excludedProfileIds: readonly string[];
  activeCandidates: readonly { electionId: string; party: string }[];
}

export function planRussianCouncilNpcSlates(input: RussianCouncilNpcSlateInput) {
  const ballotIds = new Set(input.ballots.map((row) => row.id));
  if (
    ballotIds.size !== input.ballots.length ||
    input.ballots.some((row) => !row.id || !row.regionId) ||
    new Set(input.parties).size !== input.parties.length ||
    input.parties.some((party) => !party || party === "independent") ||
    new Set(input.profiles.map((row) => row.id)).size !== input.profiles.length ||
    input.profiles.some(
      (row) => !row.id || !row.party || !row.homeState || typeof row.eligible !== "boolean"
    ) ||
    input.activeCandidates.some((row) => !ballotIds.has(row.electionId) || !row.party)
  )
    throw new Error(
      "Council slates need unique ballots, registered parties and profile identities"
    );
  const excluded = new Set(input.excludedProfileIds);
  const parties = [...input.parties].sort();
  const profiles = new Map(
    parties.map((party) => [
      party,
      input.profiles
        .filter((row) => row.party === party && row.eligible && !excluded.has(row.id))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ])
  );
  const occupied = new Map<string, number>();
  for (const row of input.activeCandidates) {
    if (row.party === "independent") continue;
    const key = `${row.electionId}:${row.party}`;
    const count = (occupied.get(key) ?? 0) + 1;
    if (count > 2)
      throw new Error("A Council association cannot nominate more than two candidates per subject");
    occupied.set(key, count);
  }
  const nominees: Array<{
    electionId: string;
    party: string;
    profileId: string;
    nomineeKey: string;
    capacity: 1;
  }> = [];
  for (const ballot of [...input.ballots].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const party of parties) {
      const key = `${ballot.id}:${party}`;
      const count = occupied.get(key) ?? 0;
      const pool = profiles.get(party)!;
      const local = pool.filter((row) => row.homeState === ballot.regionId);
      const selected = local.length ? local : pool;
      if (!selected.length) continue;
      for (let slot = count; slot < 2; slot++) {
        nominees.push({
          electionId: ballot.id,
          party,
          profileId: selected[slot % selected.length].id,
          nomineeKey: `${key}:${slot + 1}`,
          capacity: 1,
        });
      }
    }
  }
  return {
    nominees,
    unrepresentedParties: parties.filter((party) => !profiles.get(party)!.length),
  };
}

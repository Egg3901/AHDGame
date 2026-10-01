/**
 * Duma party slates use existing NPC profiles to represent bounded nominees.
 * planRussianDumaNpcSlates fills uncovered constituency party slots and adds
 * one fallback list slate per party, preserving every player candidacy.
 */
export interface RussianDumaNpcSlateInput {
  ballots: readonly { id: string; regionId: string; tier: "constituency" | "list" }[];
  parties: readonly string[];
  profiles: readonly { id: string; party: string; homeState: string; eligible: boolean }[];
  activeCandidates: readonly { electionId: string; party: string; isNpc: boolean }[];
}
export interface RussianDumaNpcSlatePlan {
  electionId: string;
  party: string;
  profileId: string;
  nomineeKey: string;
  capacity: 1 | 225;
}
export function planRussianDumaNpcSlates(input: RussianDumaNpcSlateInput): {
  nominees: RussianDumaNpcSlatePlan[];
  unrepresentedParties: string[];
} {
  if (
    input.ballots.some(
      (row) => !row.id || !row.regionId || !["constituency", "list"].includes(row.tier)
    ) ||
    new Set(input.ballots.map((row) => row.id)).size !== input.ballots.length ||
    input.parties.some((party) => !party || party === "independent") ||
    new Set(input.parties).size !== input.parties.length ||
    new Set(input.profiles.map((row) => row.id)).size !== input.profiles.length ||
    input.profiles.some((row) => !row.id || typeof row.eligible !== "boolean")
  )
    throw new Error(
      "Duma slates need unique ballots, registered parties and eligible profile identities"
    );
  const parties = [...input.parties].sort();
  const profilesByParty = new Map(
    parties.map((party) => [
      party,
      input.profiles
        .filter((row) => row.eligible && row.party === party)
        .sort((a, b) => a.id.localeCompare(b.id)),
    ])
  );
  const occupied = new Set(input.activeCandidates.map((row) => `${row.electionId}:${row.party}`));
  const occupiedByNpc = new Set(
    input.activeCandidates.filter((row) => row.isNpc).map((row) => `${row.electionId}:${row.party}`)
  );
  const nominees: RussianDumaNpcSlatePlan[] = [];
  for (const ballot of [...input.ballots].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const party of parties) {
      const key = `${ballot.id}:${party}`;
      // Players contest individual seats. A list still needs a bounded NPC
      // fallback so its party can receive more than the named players' seats.
      if ((ballot.tier === "list" ? occupiedByNpc : occupied).has(key)) continue;
      const pool = profilesByParty.get(party)!;
      const selected =
        ballot.tier === "constituency"
          ? (pool.find((row) => row.homeState === ballot.regionId) ?? pool[0])
          : pool[0];
      if (!selected) continue;
      nominees.push({
        electionId: ballot.id,
        party,
        profileId: selected.id,
        nomineeKey: key,
        capacity: ballot.tier === "list" ? 225 : 1,
      });
    }
  }
  return {
    nominees,
    unrepresentedParties: parties.filter((party) => !profilesByParty.get(party)!.length),
  };
}

/**
 * Native Hungarian Assembly campaigns keep every filed regional campaign actor.
 * The statutory district nomination limit applies inside the filed slate, and
 * final mandates wait for the country's complete mixed-election count.
 */
export interface Hu1991CampaignBinding {
  ruleVersion: "mixed-1989-v1";
  receiptId: string;
  round: 1 | 2;
  registeredVoters: number;
  rootElectionId?: string;
  byElection?: { parentReceiptId: string; districtIds: string[]; generation: number };
}
export function isHu1991AssemblyCampaign(election: {
  countryId?: string;
  electionType?: string;
  hungarianAssemblyRound?: Hu1991CampaignBinding;
}): boolean {
  return (
    election.countryId === "HU" &&
    election.electionType === "nationalAssembly" &&
    election.hungarianAssemblyRound?.ruleVersion === "mixed-1989-v1"
  );
}
export function hu1991PrimaryAdvanceLimit(
  election: Parameters<typeof isHu1991AssemblyCampaign>[0],
  candidates: number
): number | null {
  return isHu1991AssemblyCampaign(election) ? Math.max(1, candidates) : null;
}

/** Select campaign actors with at least one unresolved qualified ballot. */
export function hu1991RunoffCampaigns(
  pending: Extract<import("./mixedElection1991").Hu1991MixedCount, { kind: "pending" }>,
  nominations: import("./mandates1991").Hu1991Nominations
): Array<{ regionId: string; candidateIds: string[] }> {
  const people = new Map(nominations.people.map((row) => [row.id, row]));
  const regions = new Map<string, Set<string>>();
  for (const ids of Object.values(pending.constituencyRunoffs))
    for (const id of ids) {
      const person = people.get(id);
      if (!person) throw new Error("Hungarian runoff names an unfiled person");
      const candidates = regions.get(person.regionId) ?? new Set<string>();
      candidates.add(person.candidateId);
      regions.set(person.regionId, candidates);
    }
  for (const countyId of [...pending.territorialRunoffs, ...(pending.territorialRepeats ?? [])]) {
    const county = nominations.territorial.find((row) => row.id === countyId);
    if (!county) throw new Error("Hungarian runoff has an unfiled territorial district");
    for (const list of county.lists)
      for (const id of list.candidateIds) {
        const person = people.get(id);
        if (!person) throw new Error("Hungarian territorial runoff names an unfiled person");
        const candidates = regions.get(person.regionId) ?? new Set<string>();
        candidates.add(person.candidateId);
        regions.set(person.regionId, candidates);
      }
  }
  return [...regions]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([regionId, ids]) => ({ regionId, candidateIds: [...ids].sort() }));
}

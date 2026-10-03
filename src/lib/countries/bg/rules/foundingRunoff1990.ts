/** Only unresolved founding constituencies renew their campaigns and existing owners. */
import { BG_1990_CONSTITUENCIES } from "../data/foundingDistricts1990";
import type { BgFoundingCount } from "./foundingCount1990";
import type { BgFoundingNominations } from "./foundingMandates1990";
import type { BgFoundingBallots } from "./foundingBallots1990";
import { resolveBgFoundingFirstRound } from "./foundingMajority1990";

export function bgFoundingRunoffCampaigns(
  count: BgFoundingCount,
  nominations: BgFoundingNominations,
  ballots: BgFoundingBallots
) {
  const people = new Map(nominations.people.map((row) => [row.id, row]));
  const ballotsByDistrict = new Map(ballots.constituencies.map((row) => [row.id, row]));
  const regions = new Map<string, Set<string>>();
  for (const id of count.unresolved) {
    const district = BG_1990_CONSTITUENCIES.find((row) => row.id === id);
    const ballot = ballotsByDistrict.get(id);
    if (!district || !ballot) throw new Error("Bulgarian runoff has an unknown constituency");
    const pending = resolveBgFoundingFirstRound(ballot.first);
    if (pending.kind !== "runoff")
      throw new Error("Bulgarian runoff reopens an elected first-round seat");
    const candidates = regions.get(district.regionId) ?? new Set<string>();
    for (const personId of pending.personIds) {
      const person = people.get(personId);
      if (!person) throw new Error("Bulgarian runoff has an unknown person");
      candidates.add(person.candidateId);
    }
    regions.set(district.regionId, candidates);
  }
  return [...regions].map(([regionId, candidates]) => ({
    regionId,
    candidateIds: [...candidates].sort(),
  }));
}

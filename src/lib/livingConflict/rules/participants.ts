/**
 * Crisis participants keep distinct identities when historical actors are absent.
 * Existing belligerents and backers retain their roles; authored fallbacks fill
 * unclaimed roles. A new crisis needs every authored belligerent slot filled.
 */
import type { LivingConflictDef } from "../types";

type Participants = LivingConflictDef["participants"];

export function resolveConflictParticipants(
  def: Pick<LivingConflictDef, "participants" | "participantFallbacks">,
  availableCountryIds: ReadonlySet<string>
): Participants {
  const primaryActors = [
    ...def.participants.belligerents,
    def.participants.backerA,
    def.participants.backerB,
  ].filter((id): id is string => Boolean(id));
  // Reserve real primary actors before considering any substitute. Otherwise
  // an earlier missing belligerent can consume its own opposing backer.
  const owners = new Map<string, string>(
    primaryActors.filter((id) => availableCountryIds.has(id)).map((id) => [id, id])
  );
  const resolved = new Map<string, string | undefined>();
  const resolveOne = (id: string | undefined): string | undefined => {
    if (!id) return undefined;
    if (resolved.has(id)) return resolved.get(id);
    const candidate = [id, ...(def.participantFallbacks?.[id] ?? [])].find(
      (countryId) =>
        availableCountryIds.has(countryId) &&
        (!owners.has(countryId) || owners.get(countryId) === id)
    );
    resolved.set(id, candidate);
    if (candidate) owners.set(candidate, id);
    return candidate;
  };
  const resolveMany = (ids: string[]): string[] => [
    ...new Set(ids.map(resolveOne).filter((id): id is string => Boolean(id))),
  ];

  const belligerents = resolveMany(def.participants.belligerents);
  const backerA = resolveOne(def.participants.backerA);
  const backerB = resolveOne(def.participants.backerB);
  return {
    belligerents,
    ...(backerA ? { backerA } : {}),
    ...(backerB ? { backerB } : {}),
    neighbors: resolveMany(def.participants.neighbors),
    blocMembers: resolveMany(def.participants.blocMembers),
    bystanders: resolveMany(def.participants.bystanders),
  };
}

export function hasRequiredBelligerents(
  def: Pick<LivingConflictDef, "participants">,
  participants: Pick<Participants, "belligerents">
): boolean {
  return new Set(participants.belligerents).size >= new Set(def.participants.belligerents).size;
}

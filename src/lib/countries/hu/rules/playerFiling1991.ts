/**
 * Hungarian players file one constituency within their home campaign region.
 * A party can field one player in each district; independents share no party
 * slot. chooseHu1991PlayerDistrict preserves explicit choices and existing filings.
 */
import { HU_1991_CONSTITUENCIES } from "../data/electoralDistricts1991";
export function chooseHu1991PlayerDistrict(input: {
  personId: string;
  regionId: string;
  partyId: string;
  requestedId?: string;
  otherFilings: readonly { personId: string; partyId: string; constituencyId: string }[];
}):
  | { allowed: true; constituencyId: string }
  | { allowed: false; reason: "invalid-residence" | "outside-region" | "party-slot-full" } {
  const local = HU_1991_CONSTITUENCIES.filter((row) => row.regionId === input.regionId);
  if (!input.personId || !input.partyId || local.length === 0)
    return { allowed: false, reason: "invalid-residence" };
  const occupied = new Set(
    input.partyId === "independent"
      ? []
      : input.otherFilings
          .filter((row) => row.personId !== input.personId && row.partyId === input.partyId)
          .map((row) => row.constituencyId)
  );
  if (input.requestedId) {
    if (!local.some((row) => row.id === input.requestedId))
      return { allowed: false, reason: "outside-region" };
    return occupied.has(input.requestedId)
      ? { allowed: false, reason: "party-slot-full" }
      : { allowed: true, constituencyId: input.requestedId };
  }
  let hash = 2166136261;
  for (const char of input.personId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  for (let offset = 0; offset < local.length; offset++) {
    const district = local[(hash + offset) % local.length];
    if (!occupied.has(district.id)) return { allowed: true, constituencyId: district.id };
  }
  return { allowed: false, reason: "party-slot-full" };
}

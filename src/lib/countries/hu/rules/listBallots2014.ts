import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";

export interface HuPartyListSupport {
  partyId: string;
  registration?: number;
  organization?: number;
}

/** A distinct second-vote choice based on party support, independent of
 * district-candidate appeal. Every voter in the turn's pool casts one list vote. */
export function allocateHuListTurnVotes(
  turnout: number,
  parties: ReadonlyArray<HuPartyListSupport>
): Record<string, number> {
  if (!Number.isSafeInteger(turnout) || turnout < 0) throw new Error("Invalid Hungarian turnout");
  const weights: Record<string, number> = {};
  for (const party of parties) {
    if (!party.partyId || party.partyId === "independent" || party.partyId in weights) {
      throw new Error("Invalid Hungarian party list");
    }
    const registration = party.registration;
    const organization = party.organization;
    if (
      (registration !== undefined && (!Number.isFinite(registration) || registration < 0)) ||
      (organization !== undefined && (!Number.isFinite(organization) || organization < 0))
    ) {
      throw new Error("Invalid Hungarian party support");
    }
    weights[party.partyId] =
      registration && registration > 0
        ? registration
        : organization && organization > 0
          ? organization
          : 1;
  }
  if (Object.keys(weights).length === 0) return {};
  return apportionSeats(turnout, weights);
}

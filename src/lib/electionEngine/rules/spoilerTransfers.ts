import type { CountryId } from "@/lib/constants/countries";
import { getMajorPartiesForRegion } from "@/lib/constants/countries";
import { FPTP_SPOILER_RATE } from "../constants";
import { partitionMajorParties } from "../majorParties";

interface SpoilerCandidate {
  candidateId: string;
  party: string;
  charEP: number;
  charSP: number;
}

export interface SpoilerTransferOptions {
  countryId?: CountryId;
  parentRegionId?: string;
  spoilerRate?: number;
  useOrgAwareSpoiler?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function spoilerOrgFactor(thirdPartyOrg: number | undefined, majorOrg: number | undefined): number {
  const third = clamp(thirdPartyOrg ?? 0, 0, 100);
  const major = clamp(majorOrg ?? 0, 0, 100);
  return clamp(1 + (third - major) / 100, 0.25, 2);
}

/** Apply the shared post-allocation FPTP spoiler transfer in place. */
export function applyFptpSpoilerTransfers(
  candidates: readonly SpoilerCandidate[],
  votesByCandidate: Record<string, number>,
  partyOrganization: ReadonlyMap<string, number>,
  options: SpoilerTransferOptions = {}
): void {
  const majorPartySet = getMajorPartiesForRegion(options.countryId ?? "US", options.parentRegionId);
  const { major, third } = partitionMajorParties(
    candidates,
    majorPartySet,
    (candidate) => votesByCandidate[candidate.candidateId] ?? 0
  );
  if (third.length === 0 || major.length === 0) return;

  const rate = options.spoilerRate ?? FPTP_SPOILER_RATE;
  for (const thirdParty of third) {
    let nearest = major[0];
    let minimumDistance = Infinity;
    for (const majorParty of major) {
      const distance =
        Math.abs(thirdParty.charEP - majorParty.charEP) +
        Math.abs(thirdParty.charSP - majorParty.charSP);
      if (distance < minimumDistance) {
        minimumDistance = distance;
        nearest = majorParty;
      }
    }
    const organizationFactor = options.useOrgAwareSpoiler
      ? spoilerOrgFactor(
          partyOrganization.get(thirdParty.party),
          partyOrganization.get(nearest.party)
        )
      : 1;
    const requested = (votesByCandidate[thirdParty.candidateId] ?? 0) * rate * organizationFactor;
    const transferred = Math.min(requested, votesByCandidate[nearest.candidateId] ?? 0);
    votesByCandidate[nearest.candidateId] -= transferred;
    votesByCandidate[thirdParty.candidateId] += transferred;
  }
}

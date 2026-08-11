import {
  SUSPEND_ENDORSE_CS_TRANSFER_RATE,
  SUSPEND_ENDORSE_ORG_TRANSFER_RATE,
} from "@/lib/campaigns/constants/suspendEndorse";
import { campaignStrengthLookupKey } from "@/lib/campaigns/suspendEndorseLifecycle";
import type { ElectionCandidate } from "@/lib/db/types";

export interface SuspendEndorseCandidateLink {
  suspenderElectionCandidateId: string;
  endorsedElectionCandidateId: string;
  suspenderCampaignStrengthKey: string;
  endorsedCampaignStrengthKey: string;
}

type SuspendEndorseCandidateRow = Pick<
  ElectionCandidate,
  "_id" | "characterId" | "isNPP" | "nppId" | "campaignSuspended" | "endorsedElectionCandidateId"
>;

export function buildSuspendEndorseLinks(
  candidates: SuspendEndorseCandidateRow[]
): SuspendEndorseCandidateLink[] {
  const byElectionCandidateId = new Map(candidates.map((c) => [c._id.toString(), c]));
  const links: SuspendEndorseCandidateLink[] = [];

  for (const candidate of candidates) {
    if (!candidate.campaignSuspended || !candidate.endorsedElectionCandidateId) continue;
    const endorsed = byElectionCandidateId.get(candidate.endorsedElectionCandidateId.toString());
    if (!endorsed) continue;

    links.push({
      suspenderElectionCandidateId: candidate._id.toString(),
      endorsedElectionCandidateId: endorsed._id.toString(),
      suspenderCampaignStrengthKey: campaignStrengthLookupKey(candidate),
      endorsedCampaignStrengthKey: campaignStrengthLookupKey(endorsed),
    });
  }

  return links;
}

export function applySuspendEndorseCampaignStrengthTransfers(
  csByCampaignStrengthKey: Map<string, number>,
  links: SuspendEndorseCandidateLink[],
  transferRate = SUSPEND_ENDORSE_CS_TRANSFER_RATE
): void {
  for (const link of links) {
    const suspenderCs = csByCampaignStrengthKey.get(link.suspenderCampaignStrengthKey) ?? 0;
    const transfer = suspenderCs * transferRate;
    if (transfer <= 0) continue;

    csByCampaignStrengthKey.set(link.suspenderCampaignStrengthKey, suspenderCs - transfer);
    csByCampaignStrengthKey.set(
      link.endorsedCampaignStrengthKey,
      (csByCampaignStrengthKey.get(link.endorsedCampaignStrengthKey) ?? 0) + transfer
    );
  }
}

export function applySuspendEndorseStateOrgTransfers(
  stateOrgByStateAndCandidate: Map<string, Map<string, number>>,
  links: SuspendEndorseCandidateLink[],
  transferRate = SUSPEND_ENDORSE_ORG_TRANSFER_RATE
): void {
  for (const stateMap of stateOrgByStateAndCandidate.values()) {
    for (const link of links) {
      const suspenderLevel = stateMap.get(link.suspenderElectionCandidateId) ?? 0;
      if (suspenderLevel <= 0) continue;

      const transfer = suspenderLevel * transferRate;
      stateMap.set(link.suspenderElectionCandidateId, suspenderLevel - transfer);
      stateMap.set(
        link.endorsedElectionCandidateId,
        (stateMap.get(link.endorsedElectionCandidateId) ?? 0) + transfer
      );
    }
  }
}

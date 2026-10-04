/** Frozen founding campaigns share one400-seat receipt and retain their original registers. */
export interface BgFoundingCampaignBinding {
  ruleVersion: "parallel-1990-v1";
  receiptId: string;
  round: 1 | 2;
  registeredVoters: number;
  rootElectionId: string;
  /** Bounded Article73(3) filing window; the receipt remains authoritative. */
  newNominationDistrictIds?: string[];
  /** A fresh ballot for one vacant constituency; national list awards stay frozen. */
  byElection?: { parentReceiptId: string; districtId: string; generation: number };
}

export function isBgFoundingCampaign(election: {
  countryId?: string;
  electionType: string;
  bulgarianFoundingRound?: BgFoundingCampaignBinding;
}): boolean {
  return (
    election.countryId === "BG" &&
    election.electionType === "nationalAssembly" &&
    election.bulgarianFoundingRound?.ruleVersion === "parallel-1990-v1"
  );
}

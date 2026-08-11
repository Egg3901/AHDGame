export interface PmAppointmentCandidateView {
  _id: string;
  name: string;
  party: string | null;
  partyName: string | null;
  seatsHeld: number;
  seatsByParty: number;
}

export interface ParliamentaryVoteView {
  _id: string;
  countryId: string;
  votesFor: number;
  votesAgainst: number;
  status: string;
  openedAt: string;
  closesAt: string;
  closesOnTurn: number | null;
  closedAt: string | null;
  viewerVote: "aye" | "nay" | null;
  myWhippedFrom: string | null;
}

export interface PmAppointmentVoteView extends ParliamentaryVoteView {
  nomineeCharacterId: string;
  nomineeName: string;
  nomineePartyId: string;
  nominatedByCharacterId: string;
  formationType: string;
  coalitionId: number | null;
  coalitionPartyIds: string[] | null;
}

export interface NoConfidenceVoteView extends ParliamentaryVoteView {
  /**
   * Phase 11b: null when the vote was auto-triggered by the system (e.g.
   * sovereign-default fallout). The proposer name (`proposedByName`) still
   * carries the human-readable attribution.
   */
  proposedByCharacterId: string | null;
  proposedByName: string;
  targetPmCharacterId: string;
  targetPmName: string;
  turnProposed: number;
}

export interface VacancyView {
  officeType: string;
  state?: string;
  district?: number;
  senateClass?: number;
  vacatedAt?: Date;
}

export interface EligibleSenateAppointeeView {
  appointeeId: string;
  appointeeType: "character" | "npp";
  characterId: string;
  name: string;
  party: string;
  homeState?: string;
}

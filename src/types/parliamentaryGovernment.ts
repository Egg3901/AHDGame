/**
 * Shared payload types for parliamentary government vote display.
 * Used by executive hubs (UK, JP), the executive API route, and
 * ParliamentaryGovernmentActions client component.
 */
import type { GovernmentFormationType } from "@/lib/db/types/governmentFormation";
import type { VoteByParty } from "@/lib/congress/governmentVoteBreakdown";

export type AppointmentVotePayload = {
  type: "pmAppointment";
  /** Set for legislature-appointed head-of-state votes (RU Chairman of the
   *  Presidium) — voters span both chambers and the panel labels the office. */
  office?: "headOfState";
  officeTitle?: string;
  _id: string;
  nomineeName: string;
  nomineePartyId: string;
  formationType: GovernmentFormationType;
  coalitionId: number | null;
  votesFor: number;
  votesAgainst: number;
  voteByParty: VoteByParty[];
  status: string;
  closesAt: string;
  closesOnTurn?: number | null;
  /** Post-election incumbent-retention vote; government stays formed during it. */
  isConfidenceMotion?: boolean;
};

export type NoConfidenceVotePayload = {
  type: "noConfidence";
  _id: string;
  proposedByName: string;
  targetPmName: string;
  votesFor: number;
  votesAgainst: number;
  voteByParty: VoteByParty[];
  status: string;
  closesAt: string;
  closesOnTurn?: number | null;
};

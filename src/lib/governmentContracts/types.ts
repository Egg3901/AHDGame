/** Government tenders invite corporate bids; a winning bid becomes an existing defence or extraction contract. */
import type { UnitDomain } from "@/lib/db/types/militaryUnit";
import type { ExtractableResource } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";

export type ContractType = "defence" | "extraction";
export type TenderTab = "active" | "closed" | "awarded" | "canceled";
export type TenderTerms =
  | {
      type: "defence";
      component: UnitDomain;
      lots: number;
      grade: number;
      maximumPricePerLot: number;
    }
  | {
      type: "extraction";
      stateId: string;
      resource: ExtractableResource;
      share: number;
      termTurns: number;
      royaltyRatePerTurn: number;
      minimumSigningFeeAnchor: number;
    };
export interface ContractBid {
  corporationId: string;
  corporationName: string;
  userId: string;
  sectorId?: string;
  amount: number;
  submittedTurn: number;
  revision: number;
  withdrawn: boolean;
  system?: boolean;
}
export interface GovernmentTender {
  _id: string;
  countryId: CountryId;
  title: string;
  description: string;
  terms: TenderTerms;
  issuerLevel: "national" | "state";
  issuerPositionId?: string;
  publishedBy: string;
  publishedTurn: number;
  closesTurn: number;
  awardDeadlineTurn: number;
  status: "publishing" | "open" | "awarding" | "awarded" | "canceled";
  bids: Record<string, ContractBid>;
  bidHistory?: ContractBid[];
  revision: number;
  contractId: string;
  allocationWindowId?: string;
  reservedAmount: number;
  reservationReleased?: boolean;
  winningCorporationId?: string;
  awardReason?: string;
  awardedBy?: string;
  awardedTurn?: number;
  cancellationReason?: string;
  notificationSent?: boolean;
  awardLeaseKey?: string;
  awardLeaseRevision?: number;
  awardAttemptId?: string;
  awardLeaseUntil?: Date;
  preparedDefence?: import("@/lib/db/types/defenceContract").DefenceContract;
  preparedDefenseLine?: number;
  preparedStateOwned?: boolean;
  awardSelfDealing?: import("@/lib/db/types/defenceContract").DefenceContract["selfDealing"] | null;
  updatedAt: Date;
}
export interface TenderView extends Omit<
  GovernmentTender,
  | "bids"
  | "bidHistory"
  | "updatedAt"
  | "publishedBy"
  | "preparedDefence"
  | "preparedDefenseLine"
  | "preparedStateOwned"
  | "awardSelfDealing"
  | "awardLeaseRevision"
  | "awardLeaseKey"
  | "awardLeaseUntil"
  | "awardAttemptId"
> {
  tab: TenderTab;
  bidCount: number;
  bids: Omit<ContractBid, "userId">[];
  bidHistory: Omit<ContractBid, "userId">[];
  canManage: boolean;
  selfDealing?: { ministerName?: string; favorabilityPenalty: number };
  awardWarnings?: Record<
    string,
    { basis: "owner" | "shareholding"; stakeShare: number; favorabilityPenalty: number }
  >;
}

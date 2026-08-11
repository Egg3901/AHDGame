import type { ExtractableResource } from "@/lib/constants/commodities";

/**
 * Shared client-side row shapes for the resource-prospecting and
 * extraction-contract UI surfaces (corp sector detail, corp page, Congress,
 * state resources tab, national executive). Mirrors the server types in
 * src/lib/db/types/prospectingSurvey.ts and src/lib/db/types/extractionContract.ts,
 * trimmed/serialized for the client (ObjectId -> string, Date -> ISO string).
 */

export type ProspectInitiatorType = "corporation" | "national_government" | "state_government";
export type ProspectStatus = "active" | "succeeded" | "failed";

export interface ProspectingSurveyRow {
  _id: string;
  initiatorType: ProspectInitiatorType;
  corporationId?: string;
  countryId: string;
  stateId: string;
  resource: ExtractableResource;
  startedTurn: number;
  completesTurn: number;
  costAnchor: number;
  status: ProspectStatus;
  capacityGained?: number;
  resolvedTurn?: number;
}

export type ExtractionContractStatus = "offered" | "active" | "declined" | "expired" | "defaulted";

export interface ExtractionContractRow {
  _id: string;
  stateId: string;
  countryId: string;
  corporationId: string;
  corporationName?: string;
  resource: ExtractableResource;
  share: number;
  grantedTurn: number;
  grantedBy: string;
  grantedByLevel: "state" | "national";
  revokedTurn?: number;
  /** Absent = legacy/admin grant, treated as active. */
  status?: ExtractionContractStatus;
  signingFeeAnchor?: number;
  royaltyRatePerTurn?: number;
  termTurns?: number;
  activatedTurn?: number;
  expiresTurn?: number;
  offerExpiresTurn?: number;
  missedPayments?: number;
}

/** Which government level(s) may issue extraction contracts for a country. */
export type ContractAuthority = "national" | "both" | "state";

/** Wire shape of GET /api/contracts/extraction/eligible-corporations. */
export interface EligibleCorporation {
  id: string;
  name: string;
  ceoName?: string;
}

export interface HeadroomInfo {
  contractedShare: number;
  remainingHeadroom: number;
  authority: ContractAuthority;
}

/** Effective status for display when the doc predates the `status` field. */
export function effectiveContractStatus(c: {
  status?: ExtractionContractStatus;
  revokedTurn?: number;
}): ExtractionContractStatus {
  if (c.status) return c.status;
  return c.revokedTurn != null ? "expired" : "active";
}

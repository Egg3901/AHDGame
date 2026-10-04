/** Explicit borrower consent carried with a reviewed construction quote. */
export interface ConstructionFinanceRequest {
  bankId: string;
  requestId: string;
  principal: number;
  termTurns: number;
  maximumCostLocal: number;
  maximumRatePercent: number;
  pledgeConsent: true;
}
export interface ConstructionFinanceView {
  corporationId: string;
  currency: import("@/lib/constants/currencies").CurrencyCode;
  localPerAnchor: number;
  pendingRequest?: { claimId: string; status: "awaiting_approval" | "funding" };
}
export interface ConstructionFinanceChoice {
  request: ConstructionFinanceRequest | null;
  affordable: boolean;
}

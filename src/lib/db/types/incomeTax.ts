import type { CountryId } from "@/lib/constants/countries";
import type { ObjectId } from "mongodb";
import type { IncomeTier } from "@/lib/budget/rules/incomeTaxTiers";

/** One immutable assessed liability. Collection and payment status can advance. */
export interface PlayerIncomeTaxAssessment {
  /** Absent on legacy income-tax receipts. Both levies share guarded settlement. */
  taxKind?: "income" | "capitalGains";
  _id: string;
  characterId: ObjectId;
  ownerCollection: "characters" | "imperialCharacters";
  turn: number;
  worldId: string;
  name: string;
  tier: IncomeTier;
  currency: string;
  sourcePath: string;
  sourceFx: number;
  /** Wallet units per anchor; absent preserves already-frozen legacy debit terms. */
  walletFx?: number;
  countryId: CountryId;
  nationalBudgetId: string;
  nationalCurrency: string;
  nationalFx: number;
  stateId: string;
  regionalCurrency: string;
  regionalFx: number;
  gross: number;
  federal: number;
  regional: number;
  net: number;
  status: "unpaid" | "collected" | "paid";
  collectedTurn?: number;
  createdAt: Date;
}
/** A single retained target proof plus a monotonic watermark prevents stale replays. */
export interface IncomeTaxBatchReceipt {
  key: string;
  turn: number;
  paid?: boolean;
}

/** Closing-turn tax terms are frozen before liabilities or money are written. */
export interface PlayerIncomeTaxTurnPlan {
  _id: string;
  status: "plan";
  worldId: string;
  turn: number;
  characterId: ObjectId;
  ownerCollection: "characters" | "imperialCharacters";
  tier: IncomeTier;
  assessments: PlayerIncomeTaxAssessment[];
  /** Sale-credit identities frozen with this plan, including delayed credits. */
  stockTaxReceiptIds?: string[];
}

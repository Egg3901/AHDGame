import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/** Collection: "governorExecutiveOrders" */
export interface GovernorExecutiveOrder {
  _id?: ObjectId;
  countryId: CountryId;
  stateId: string;
  issuedByCharacterId: ObjectId;
  issuedByName: string;

  legislationTypeId: string;
  effectDirection: 1 | -1;
  /** Number of policy-option steps shifted (1 or 2). Optional for backward compat
   *  with orders issued before multi-step support; treat undefined as 1. */
  steps?: 1 | 2;
  /** True when an admin issued this order via override (bypassed office-holder
   *  eligibility + AP cost). Useful for history audit + visual flagging. */
  adminProposed?: boolean;

  policyOptionIndexBefore: number; // ladder index (0-6 legacy; 0-4 new-generation political laws)
  policyOptionIndexAfter: number; // ladder index (0-6 legacy; 0-4 new-generation political laws)
  /** Snapshot of the policyOptionId at issue time, so rescind/expiry can revert
   *  to the exact prior option rather than leaving a stale "after" id behind. */
  policyOptionIdBefore?: string;
  /** Snapshot of the economic axis at issue time — restored on revert so the
   *  State Policy page (which matches by axes) shows the right base option. */
  economicBefore?: number;
  /** Snapshot of the social axis at issue time — restored on revert. */
  socialBefore?: number;

  issuedAtTurn: number;
  expiresAtTurn: number;
  status: "active" | "expired" | "rescinded" | "superseded";
  rescindedAtTurn?: number;
  rescindedByCharacterId?: ObjectId;
  supersededByBillId?: ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

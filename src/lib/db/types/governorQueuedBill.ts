import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { StateBillProvision } from "./stateBill";

/** Collection: "governorLegislationQueue" */
export interface GovernorQueuedBill {
  _id?: ObjectId;
  countryId: CountryId;
  stateId: string;
  governorCharacterId: ObjectId;
  governorName: string;
  targetNppId: ObjectId;
  targetNppName: string;
  targetPartyId: string;

  // Full bill draft.
  title: string;
  summary: string;
  category?: string;
  legislationTypeId?: string;
  effectDirection?: number;
  provisions?: StateBillProvision[];

  // Cost paid up-front by the governor; refunded on cancel/auto-cancel.
  proposalActionCost: number;
  proposalNpiCost: number;

  queuedAtTurn: number;
  status: "pending" | "fired" | "cancelled" | "auto_cancelled";
  firedBillId?: ObjectId;
  cancelReason?:
    | "manual"
    | "npp_lost_seat"
    | "npp_retired"
    | "npp_party_changed"
    | "npp_already_has_active_bill"
    | "governor_left_office"
    | "invalid_provisions";
  createdAt: Date;
  updatedAt: Date;
}

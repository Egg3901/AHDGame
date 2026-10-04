import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";

/** Persisted issuer-selected bank terms frozen for a placement. */
export interface PrimaryUnderwritingMandate {
  bankCorporationId: ObjectId;
  charteredTurn: number;
  currencyCode: CurrencyCode;
  feeRate: number;
  selectedAtTurn: number;
}

/** Persisted quote and charter epoch for one specific placement. */
export interface PrimaryUnderwritingOffer {
  bankCorporationId: ObjectId;
  issuerCorporationId: ObjectId;
  charteredTurn: number;
  currencyCode: CurrencyCode;
  feeRate: number;
  instrumentType: "equity" | "corporate_bond";
  instrumentId?: ObjectId;
  originalQuoteTurn: number;
}

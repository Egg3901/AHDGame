import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";

export interface PrimaryUnderwritingCharter {
  status?: string;
  type?: string;
  currency?: string;
  charteredTurn?: number;
}

export interface PrimaryUnderwritingFeeQuote {
  grossPlacedLocal: number;
  feeLocal: number;
  issuerNetLocal: number;
}

export interface PrimaryUnderwritingMandate {
  bankCorporationId: ObjectId;
  charteredTurn: number;
  currencyCode: CurrencyCode;
  feeRate: number;
  selectedAtTurn: number;
}

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

/** 1.5% modest placement fee; rounded to the game's cent-denominated cash unit. */
export const DEFAULT_PRIMARY_UNDERWRITING_FEE_RATE = 0.015;

export function primaryUnderwritingCharterEligible(
  charter: PrimaryUnderwritingCharter | null | undefined,
  currency: string
): boolean {
  return (
    charter?.status === "active" &&
    (charter.type === "investment" || charter.type === "universal") &&
    charter.currency === currency &&
    Number.isInteger(charter.charteredTurn) &&
    (charter.charteredTurn ?? -1) >= 0
  );
}

export function quotePrimaryUnderwritingFee(input: {
  grossPlacedLocal: number;
  feeRate: number;
}): PrimaryUnderwritingFeeQuote {
  const { grossPlacedLocal, feeRate } = input;
  if (!Number.isFinite(grossPlacedLocal) || grossPlacedLocal < 0)
    throw new Error("Gross placed proceeds must be finite and non-negative");
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 0.1)
    throw new Error("Underwriting fee rate must be between 0 and 10 percent");
  const gross = Math.round(grossPlacedLocal * 100) / 100;
  const fee = Math.round(gross * feeRate * 100) / 100;
  return { grossPlacedLocal: gross, feeLocal: fee, issuerNetLocal: gross - fee };
}

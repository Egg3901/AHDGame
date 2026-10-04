import type { ObjectId } from "mongodb";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";

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
  /** Actual issuer and bank currency identity frozen before any cash moves. */
  issuerCurrencySnapshot: PrimaryUnderwritingCurrencySnapshot;
  bankCurrencySnapshot: PrimaryUnderwritingCurrencySnapshot;
}

export interface PrimaryUnderwritingCurrencySnapshot {
  currencyCode: CurrencyCode;
  liquidCurrencyCodePresent: boolean;
  liquidCurrencyCode?: string | null;
  countryIdPresent: boolean;
  countryId?: string | null;
}

export function capturePrimaryUnderwritingCurrencySnapshot(input: {
  liquidCurrencyCode?: string | null;
  countryId?: string | null;
}): PrimaryUnderwritingCurrencySnapshot | null {
  const raw = input.liquidCurrencyCode;
  const explicit = raw !== undefined && raw !== null && String(raw).trim() !== "";
  const countryId = input.countryId;
  const fallbackCurrency =
    countryId && countryId in COUNTRY_CURRENCY_MAP
      ? COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP]
      : undefined;
  const currencyCode = explicit ? (raw as CurrencyCode) : fallbackCurrency;
  if (!currencyCode) return null;
  return {
    currencyCode,
    liquidCurrencyCodePresent: Object.hasOwn(input, "liquidCurrencyCode"),
    ...(Object.hasOwn(input, "liquidCurrencyCode") ? { liquidCurrencyCode: raw } : {}),
    countryIdPresent: Object.hasOwn(input, "countryId"),
    ...(Object.hasOwn(input, "countryId") ? { countryId } : {}),
  };
}

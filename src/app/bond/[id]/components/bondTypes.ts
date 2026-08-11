import type { CurrencyCode } from "@/lib/constants/currencies";

export interface BondDetail {
  _id: string;
  issuerType?: "corporation" | "sovereign";
  countryId?: string | null;
  /** Bond's currency (Task 18B, v0.2.6). Missing = legacy/pre-stamp bond. */
  currencyCode?: string | null;
  corporationId: string;
  corporationName: string;
  corporationSequentialId?: number;
  corporationLogoUrl?: string;
  corporationBrandColor?: string;
  faceValue: number;
  pricePerUnit: number;
  couponRate: number;
  maturityTurns: number;
  maturityLabel: string;
  issuedAtTurn: number;
  maturityTurn: number;
  turnsRemaining: number;
  turnsElapsed: number;
  marketPrice: number;
  totalIssued: number;
  totalUnits: number;
  publicFloat: number;
  heldUnits: number;
  publicFloatPercentage: number;
  defaulted: boolean;
  defaultedAtTurn: number | null;
  defaultCure?: {
    cureMethod: "cash" | "refinance" | "parent_payoff";
    curedAtTurn: number;
  } | null;
  matured: boolean;
  annualCouponPerUnit: number;
  perTurnCoupon: number;
  totalInterestPaid: number;
  currentTurn: number;
  yieldToMaturity: number;
}

export interface BondUserContext {
  isCeo: boolean;
  myCharacterId: string | null;
  myCashOnHand: number;
  myBondUnits: number;
  myCorporation: {
    id: string;
    name: string;
    liquidCapital: number;
    liquidCapitalLocal: number;
    liquidCurrencyCode?: CurrencyCode | null;
    bondUnits: number;
  } | null;
  currencyBalances?: { personal: Partial<Record<CurrencyCode, number>> } | null;
  homeCurrency?: CurrencyCode | null;
  autoConvertEnabled?: boolean;
}

export interface PricePoint {
  turn: number;
  marketPrice: number;
  totalInterestPaid: number;
}

export interface Holder {
  type: "character" | "corporation";
  id: string;
  name: string;
  avatarUrl?: string;
  logoUrl?: string;
  sequentialId?: number;
  units: number;
  percentage: number;
  value: number;
}

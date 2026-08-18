import type { BankCharterType } from "@/lib/db/types/bank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CreditBandId, LendingProfileId } from "@/lib/banking/creditBands";

export type Corridor = { minOffset: number; maxOffset: number };

/** A named counterparty, resolved server-side. Never a bare ObjectId in the UI. */
export type Party = {
  id: string;
  name: string;
  sequentialId: number | null;
  ticker?: string | null;
};

export type ConsolePayload = {
  privateBankingEnabled: boolean;
  bankPropTradingEnabled: boolean;
  visible: boolean;
  isCeo: boolean;
  isAdmin: boolean;
  isChair: boolean;
  canMutate: boolean;
  canRevoke: boolean;
  corporation: {
    id: string;
    name: string;
    liquidCapital: number;
    liquidCurrencyCode: string;
    countryId?: string;
    ownsFinancial: boolean;
  };
  currency: CurrencyCode;
  /** Current game turn, for the charter-switch cooldown countdown. */
  currentTurn: number;
  legalCharterTypes: BankCharterType[];
  eligibleTypes: BankCharterType[];
  eligibilityReasons: string[];
  capitalRequirement: number;
  capitalRequirementByType: Record<BankCharterType, number>;
  risk: {
    cashReserves: number;
    requiredReserves: number;
    runFailureThreshold: number;
    reserveCoverRatio: number;
    headroomToFailure: number;
    oneBandFromFailure: boolean;
    terms: Array<{
      key: string;
      label: string;
      contribution: number;
      max: number;
      lever: string;
    }>;
    confidence: number;
    band: "green" | "amber" | "red";
    verdict: string;
  } | null;
  /**
   * Every cap a player can hit, with its formula and current inputs, from the
   * module that enforces it. Null when there is no active charter.
   */
  caps: Array<{
    key: string;
    label: string;
    formula: string;
    inputs: Array<{ label: string; value: number }>;
    value: number;
    lever: string;
  }> | null;
  corridors: { deposit: Corridor; lending: Corridor } | null;
  reserveRatio: number | null;
  depositCeiling: number | null;
  defaultBranchCapacityShare: number;
  /** Catalog for the blacklist fund picker. Absent for viewers who cannot edit. */
  blacklistableFunds?: { slug: string; name: string }[];
  charter: {
    type: BankCharterType;
    status: string;
    currency: CurrencyCode;
    charteredTurn: number;
    postedCapital: number;
    depositOffset: number;
    lendingOffset: number;
    totalDeposits: number;
    totalLoans: number;
    npcDeposits: number;
    cashReserves: number;
    requiredReserves: number;
    upstreamCapacity: number;
    lendingProfile: LendingProfileId;
    discountWindowDebt: number;
    discountWindowArrears: number;
    cbMarginArrears: number;
    capitalStanding: string | null;
    capitalRatio: number | null;
    stressedCapitalRatio: number | null;
    appliedStressLossFraction: number | null;
    charterSwitchCooldownUntilTurn: number | null;
    confidence: number | null;
    warningBand: "green" | "amber" | "red" | null;
    panicTurns: number;
    branchCapacityShare: number;
    requireApproval: boolean;
    depositCeiling: number;
    interbankDebt: number;
    cbMarginDebt: number;
    propBookMarkValue: number;
    propBook: Array<{
      asset: string;
      ref: string;
      units: number;
      costBasis: number;
      markValue: number | null;
    }>;
    /** Null for viewers who are not the CEO, an admin, or the currency's chair. */
    blacklist: {
      corporations: Party[];
      characters: Party[];
      indexFunds: { slug: string; name: string }[];
    } | null;
  } | null;
  rates: { depositRatePercent: number; lendingRatePercent: number } | null;
  loans: Array<{
    id: string;
    borrowerType: string;
    borrower: Party | null;
    creditBand: CreditBandId | null;
    principal: number;
    outstanding: number;
    ratePercent: number;
    originatedTurn: number;
    termTurns: number;
    status: string;
    arrearsTurns: number;
  }>;
  householdBook: {
    rows: Array<{
      band: CreditBandId;
      outstanding: number;
      ratePercent: number | null;
      expectedDefaultRatePercent: number;
      demandShare: number;
      open: boolean;
      isLegacy: boolean;
      tranches: number;
    }>;
    total: number;
    lendingProfile: LendingProfileId;
    blendedRatePercent: number | null;
    blendedExpectedDefaultPercent: number | null;
  } | null;
  interbankLoans: Array<{
    id: string;
    lenderCorporationId: string;
    borrowerCorporationId: string;
    counterparty: Party | null;
    principal: number;
    outstanding: number;
    ratePercent: number;
    originatedTurn: number;
    status: string;
    role: "lender" | "borrower";
  }>;
};

export type BankTab = "overview" | "lending" | "funding" | "trading" | "admin";

export type DiscountWindowQuote = {
  available: boolean;
  capAnchor?: number;
  headroomAnchor?: number;
  ratePercent?: number;
  outstanding: number;
  currentStigma: number;
  maxStigma: number;
};

/** Toast signature the console panels are handed by the tab shell. */
export type ShowToast = (msg: string, variant?: "success" | "error" | "info") => void;

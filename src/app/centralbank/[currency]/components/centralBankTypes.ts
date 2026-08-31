import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CreditRating } from "@/lib/db/types/centralBank";

export interface ChairData {
  characterId: string;
  sequentialId?: number;
  name: string;
  avatarUrl?: string;
  partyId?: string;
  partyName?: string;
  borderKey?: string | null;
  tintColor?: string | null;
}

export interface TurnSnapshot {
  turn: number;
  rate: number;
}

export interface Nomination {
  characterId: string;
  characterName: string;
  nominatedByName: string;
  nominatedAt: string;
}

export interface LobbyingTotal {
  characterId: string;
  sequentialId?: number;
  characterName: string;
  avatarUrl: string | null;
  borderKey?: string | null;
  tintColor?: string | null;
  totalAmount: number;
}

export interface InflationBreakdown {
  base: number;
  unemployment: number;
  gdp: number;
  monetary: number;
  fiscal: number;
  tariff: number;
  wage: number;
  commodity: number;
  forex: number;
  savings: number;
  policy: number;
  moneySupply?: number;
  inertia: number;
}

export interface BalanceSheet {
  homeCurrency: CurrencyCode;
  totalDeposits: number;
  bankReserves: number;
  reservePortfolio: {
    homeCurrency: CurrencyCode;
    homeReserveBalance: number;
    spreadFeeReserveBalances: Partial<Record<CurrencyCode, number>>;
    spreadFeeReservesHomeValue: number;
    totalReservesHomeValue: number;
    entries: Array<{
      currencyCode: CurrencyCode;
      balance: number;
      valueInHomeCurrency: number;
      shareOfSpreadFeeReserves: number;
    }>;
    foreignEntries: Array<{
      currencyCode: CurrencyCode;
      balance: number;
      valueInHomeCurrency: number;
      shareOfSpreadFeeReserves: number;
    }>;
  };
  forexRevenue: number;
  totalLoansOutstanding: number;
  systemCap: number;
  availableCapacity: number;
  /** Max home-currency face the chair may move forex → lending this action. */
  reservePoolTransferMaxToLending?: number;
  /** Max home-currency face the chair may move lending → forex this action. */
  reservePoolTransferMaxToForex?: number;
  /** Turns until the chair may transfer again (0 = ready). */
  reservePoolTransferCooldownRemaining?: number;
  /** Absolute turn when the next transfer becomes available. */
  reservePoolTransferNextTurn?: number | null;
}

export interface BankFinancials {
  homeCurrency: CurrencyCode;
  savingsInterestExpenseLifetime: number;
  locInterestAccruedLifetime: number;
  locInterestReceivedLifetime: number;
  netInterestIncomeLifetime: number;
}

export interface MoneySupplyView {
  turn: number;
  currencyCode: CurrencyCode;
  m1: number;
  m2: number;
  annualizedM2GrowthPct: number;
  householdLiquid: number;
  campaignLiquid: number;
  nppLiquid: number;
  corporateLiquid: number;
  partyLiquid: number;
  governmentLiquid: number;
  fundLiquid: number;
  organizationLiquid: number;
  householdSavings: number;
  externalBroadMoney: number;
  bankReserves: number;
  creditOutstanding: number;
  sovereignBondsOutstanding: number;
  centralBankBondHoldings: number;
  netMoneyCreatedLifetime: number;
  lastOperationTurn: number | null;
  lastPolicyEvaluation: {
    turn: number;
    decision: "qe" | "qt" | "treasury_advance" | "liquidity_injection" | "hold";
    rationale: string;
    inflation: number;
    targetInflation: number;
    gdpGrowth: number;
    annualizedM2GrowthPct: number;
    moneyGrowthReliable: boolean;
    bankReserves: number;
    gdp: number;
  } | null;
  operations: Array<{
    type: "qe" | "qt" | "treasury_advance" | "liquidity_injection";
    turn: number;
    amount: number;
    moneySupplyDelta: number;
    reserveDelta: number;
    actorName: string;
    reason?: string;
  }>;
  eligibleBonds: Array<{
    _id: string;
    issuerName?: string;
    couponRate: number;
    maturityTurn: number;
    marketPrice: number;
    publicFloat: number;
    centralBankHoldings?: number;
    qeSupportRatio?: number;
  }>;
}

export interface BankData {
  countryId: string;
  bankName: string;
  abbreviation: string;
  chairTitle: string;
  primeRate: number;
  lastRateChangeTurn: number | null;
  currentSavingsPressure: number;
  currentInflation: number;
  targetInflation: number;
  inflationBreakdownTotal?: number;
  inflationBreakdown: InflationBreakdown;
  effectiveRate: number;
  rateScale: Record<CreditRating, number>;
  chair: ChairData | null;
  chairMode?: "character" | "npp";
  chairNppId?: string | null;
  chairAppointedAt: string | null;
  chairInfamy: number;
  /** Consecutive turns the corridor stance has been held; drives the recovery hint. */
  resolveStreak?: number;
  chairTermExpiresAtTurn: number | null;
  currentTurn: number;
  nominationWindowOpen: boolean;
  nominations: Nomination[];
  lobbyingTotals: LobbyingTotal[];
  interestRateHistory: TurnSnapshot[];
  inflationHistory: TurnSnapshot[];
  gdpGrowthHistory: TurnSnapshot[];
  savingsFlowHistory: TurnSnapshot[];
  isChair: boolean;
  isAdmin: boolean;
  chairControlsLocked?: boolean;
  /** True when a committee is seated, so the rate moves by vote and not by decree. */
  committeeSeated?: boolean;
  /** True when a committee exists but cannot carry a motion; the chairman holds the rate directly. */
  committeeDead?: boolean;
  /** True when the government, not the bank, sets the policy rate (pre-1997 BoE). */
  governmentControlled?: boolean;
  /** True when the signed-in viewer may set the rate under government control. */
  viewerSetsRate?: boolean;
  /** True when the signed-in character is the pending chair nominee (ticket #1072). */
  viewerIsChairNominee?: boolean;
  isExecutive: boolean;
  userCashOnHand: number;
  nationalCurrency?: CurrencyCode;
  userLobbyLiquid?: number;
  userHomeCurrency?: CurrencyCode;
  userHomeLiquid?: number;
  lineOfCreditEnabled?: boolean;
  balanceSheet?: BalanceSheet | null;
  bankFinancials?: BankFinancials | null;
  moneySupply?: MoneySupplyView | null;
  chairSelectionPending?: {
    characterId: string;
    characterName: string;
    pool: "political" | "economic";
    proposedAt: string;
    /** Turn the pending pick was proposed; drives the acceptance-window countdown. */
    proposedAtTurn: number | null;
    /** Turns the nominee has left to accept before the pick auto-lapses; null for legacy docs. */
    acceptanceTurnsRemaining: number | null;
  } | null;
  pendingChairRequiresMyResponse?: boolean;
  intervention?: import("./CentralBankInterventionTab").InterventionData;
}

import { useReducer, type Dispatch } from "react";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type {
  PricingData,
  CapitalData,
  SectorData,
  CorporationRef,
  CeoRef,
  Margins,
  Financials,
  Market,
  CommoditiesData,
  StrategyData,
  PlantsData,
  AttackInfo,
  StateResources,
  ExtractionCapacityRow,
  ResourceOpportunity,
  ForSaleInfo,
  FinancialVisibility,
} from "./types";

export interface ForSaleMessage {
  type: "error" | "success";
  text: string;
}

export interface SectorPageState {
  sector: SectorData | null;
  corporation: CorporationRef | null;
  ceo: CeoRef | null;
  margins: Margins | null;
  financials: Financials | null;
  /** Why money figures are or aren't shown — labels the "—" cells so a hidden
   * value is never read as a real $0. Defaults to visible for older responses. */
  financialVisibility: FinancialVisibility;
  market: Market | null;
  commodities: CommoditiesData | null;
  pricing: PricingData | null;
  capital: CapitalData | null;
  /** Plants tier payload — null in every world below `marketSystemMode >= "plants"`. */
  plants: PlantsData | null;
  /** True when this world runs the plants market tier (drives the whole layout). */
  plantsEnabled: boolean;
  isCeo: boolean;
  labourEnabled: boolean;
  labourFullEnabled: boolean;
  /** gameConfig.prospectingEnabled — gates the CEO Prospect action on extraction sectors. */
  prospectingEnabled: boolean;
  strategy: StrategyData | null;
  loading: boolean;
  error: string;
  growthUpdating: boolean;
  growthMessage: string;
  strategyUpdating: boolean;
  cancelTransitionLoading: boolean;
  abandonConfirm: boolean;
  abandoning: boolean;
  attackInfo: AttackInfo | null;
  attacking: boolean;
  attackMsg: string;
  attackError: string;
  splitting: boolean;
  splitMsg: string;
  splitError: string;
  policyDraft: number;
  policySaving: boolean;
  policyMessage: string;
  wageDraft: number;
  wageSaving: boolean;
  wageMessage: string;
  wageError: boolean;
  nameDraft: string;
  nameSaving: boolean;
  nameMessage: string;
  stateResources: StateResources;
  extractionCapacity: ExtractionCapacityRow[] | null;
  extractionOpportunities: ResourceOpportunity[] | null;
  forexEnabled: boolean;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
  forSaleInfo: ForSaleInfo | null;
  listingForSale: boolean;
  unlistingForSale: boolean;
  buyingSector: boolean;
  forSaleMessage: ForSaleMessage | null;
}

export type SectorPageAction =
  | { type: "SET_SECTOR"; value: SectorData | null }
  | { type: "UPDATE_SECTOR_PARTIAL"; patch: Partial<SectorData> }
  | { type: "SET_CORPORATION"; value: CorporationRef | null }
  | { type: "SET_CEO"; value: CeoRef | null }
  | { type: "SET_MARGINS"; value: Margins | null }
  | { type: "SET_FINANCIALS"; value: Financials | null }
  | { type: "SET_FINANCIAL_VISIBILITY"; value: FinancialVisibility }
  | { type: "SET_MARKET"; value: Market | null }
  | { type: "SET_COMMODITIES"; value: CommoditiesData | null }
  | { type: "SET_PRICING"; value: PricingData | null }
  | { type: "SET_CAPITAL"; value: CapitalData | null }
  | { type: "SET_PLANTS"; value: PlantsData | null }
  | { type: "SET_PLANTS_ENABLED"; value: boolean }
  | { type: "SET_IS_CEO"; value: boolean }
  | { type: "SET_STRATEGY"; value: StrategyData | null }
  | { type: "SET_LOADING"; value: boolean }
  | { type: "SET_ERROR"; value: string }
  | { type: "SET_GROWTH_UPDATING"; value: boolean }
  | { type: "SET_GROWTH_MESSAGE"; value: string }
  | { type: "SET_STRATEGY_UPDATING"; value: boolean }
  | { type: "SET_CANCEL_TRANSITION_LOADING"; value: boolean }
  | { type: "SET_ABANDON_CONFIRM"; value: boolean }
  | { type: "SET_ABANDONING"; value: boolean }
  | { type: "SET_ATTACK_INFO"; value: AttackInfo | null }
  | { type: "SET_ATTACKING"; value: boolean }
  | { type: "SET_ATTACK_MSG"; value: string }
  | { type: "SET_ATTACK_ERROR"; value: string }
  | { type: "SET_SPLITTING"; value: boolean }
  | { type: "SET_SPLIT_MSG"; value: string }
  | { type: "SET_SPLIT_ERROR"; value: string }
  | { type: "SET_POLICY_DRAFT"; value: number }
  | { type: "SET_POLICY_SAVING"; value: boolean }
  | { type: "SET_POLICY_MESSAGE"; value: string }
  | { type: "SET_LABOUR_ENABLED"; value: boolean }
  | { type: "SET_LABOUR_FULL_ENABLED"; value: boolean }
  | { type: "SET_PROSPECTING_ENABLED"; value: boolean }
  | { type: "SET_WAGE_DRAFT"; value: number }
  | { type: "SET_WAGE_SAVING"; value: boolean }
  | { type: "SET_WAGE_MESSAGE"; value: string; error?: boolean }
  | { type: "SET_NAME_DRAFT"; value: string }
  | { type: "SET_NAME_SAVING"; value: boolean }
  | { type: "SET_NAME_MESSAGE"; value: string }
  | { type: "SET_STATE_RESOURCES"; value: StateResources }
  | { type: "SET_EXTRACTION_CAPACITY"; value: ExtractionCapacityRow[] | null }
  | { type: "SET_EXTRACTION_OPPORTUNITIES"; value: ResourceOpportunity[] | null }
  | { type: "SET_FOREX_ENABLED"; value: boolean }
  | { type: "SET_EXCHANGE_RATES"; value: Partial<Record<CurrencyCode, number>> }
  | { type: "SET_FOR_SALE_INFO"; value: ForSaleInfo | null }
  | { type: "SET_LISTING_FOR_SALE"; value: boolean }
  | { type: "SET_UNLISTING_FOR_SALE"; value: boolean }
  | { type: "SET_BUYING_SECTOR"; value: boolean }
  | { type: "SET_FOR_SALE_MESSAGE"; value: ForSaleMessage | null };

const initialState: SectorPageState = {
  sector: null,
  corporation: null,
  ceo: null,
  margins: null,
  financials: null,
  financialVisibility: { hidden: false, reason: "visible" },
  market: null,
  commodities: null,
  pricing: null,
  capital: null,
  plants: null,
  plantsEnabled: false,
  isCeo: false,
  labourEnabled: false,
  labourFullEnabled: false,
  prospectingEnabled: false,
  strategy: null,
  loading: true,
  error: "",
  growthUpdating: false,
  growthMessage: "",
  strategyUpdating: false,
  cancelTransitionLoading: false,
  abandonConfirm: false,
  abandoning: false,
  attackInfo: null,
  attacking: false,
  attackMsg: "",
  attackError: "",
  splitting: false,
  splitMsg: "",
  splitError: "",
  policyDraft: 0,
  policySaving: false,
  policyMessage: "",
  wageDraft: 1,
  wageSaving: false,
  wageMessage: "",
  wageError: false,
  nameDraft: "",
  nameSaving: false,
  nameMessage: "",
  stateResources: null,
  extractionCapacity: null,
  extractionOpportunities: null,
  forexEnabled: false,
  exchangeRates: {},
  forSaleInfo: null,
  listingForSale: false,
  unlistingForSale: false,
  buyingSector: false,
  forSaleMessage: null,
};

export function sectorPageReducer(
  state: SectorPageState,
  action: SectorPageAction
): SectorPageState {
  switch (action.type) {
    case "SET_SECTOR":
      return { ...state, sector: action.value };
    case "UPDATE_SECTOR_PARTIAL":
      return { ...state, sector: state.sector ? { ...state.sector, ...action.patch } : null };
    case "SET_CORPORATION":
      return { ...state, corporation: action.value };
    case "SET_CEO":
      return { ...state, ceo: action.value };
    case "SET_MARGINS":
      return { ...state, margins: action.value };
    case "SET_FINANCIALS":
      return { ...state, financials: action.value };
    case "SET_FINANCIAL_VISIBILITY":
      return { ...state, financialVisibility: action.value };
    case "SET_MARKET":
      return { ...state, market: action.value };
    case "SET_PRICING":
      return { ...state, pricing: action.value };
    case "SET_CAPITAL":
      return { ...state, capital: action.value };
    case "SET_PLANTS":
      return { ...state, plants: action.value };
    case "SET_PLANTS_ENABLED":
      return { ...state, plantsEnabled: action.value };
    case "SET_COMMODITIES":
      return { ...state, commodities: action.value };
    case "SET_IS_CEO":
      return { ...state, isCeo: action.value };
    case "SET_STRATEGY":
      return { ...state, strategy: action.value };
    case "SET_LOADING":
      return { ...state, loading: action.value };
    case "SET_ERROR":
      return { ...state, error: action.value };
    case "SET_GROWTH_UPDATING":
      return { ...state, growthUpdating: action.value };
    case "SET_GROWTH_MESSAGE":
      return { ...state, growthMessage: action.value };
    case "SET_STRATEGY_UPDATING":
      return { ...state, strategyUpdating: action.value };
    case "SET_CANCEL_TRANSITION_LOADING":
      return { ...state, cancelTransitionLoading: action.value };
    case "SET_ABANDON_CONFIRM":
      return { ...state, abandonConfirm: action.value };
    case "SET_ABANDONING":
      return { ...state, abandoning: action.value };
    case "SET_ATTACK_INFO":
      return { ...state, attackInfo: action.value };
    case "SET_ATTACKING":
      return { ...state, attacking: action.value };
    case "SET_ATTACK_MSG":
      return { ...state, attackMsg: action.value };
    case "SET_ATTACK_ERROR":
      return { ...state, attackError: action.value };
    case "SET_SPLITTING":
      return { ...state, splitting: action.value };
    case "SET_SPLIT_MSG":
      return { ...state, splitMsg: action.value };
    case "SET_SPLIT_ERROR":
      return { ...state, splitError: action.value };
    case "SET_POLICY_DRAFT":
      return { ...state, policyDraft: action.value };
    case "SET_POLICY_SAVING":
      return { ...state, policySaving: action.value };
    case "SET_POLICY_MESSAGE":
      return { ...state, policyMessage: action.value };
    case "SET_LABOUR_ENABLED":
      return { ...state, labourEnabled: action.value };
    case "SET_LABOUR_FULL_ENABLED":
      return { ...state, labourFullEnabled: action.value };
    case "SET_PROSPECTING_ENABLED":
      return { ...state, prospectingEnabled: action.value };
    case "SET_WAGE_DRAFT":
      return { ...state, wageDraft: action.value };
    case "SET_WAGE_SAVING":
      return { ...state, wageSaving: action.value };
    case "SET_WAGE_MESSAGE":
      return { ...state, wageMessage: action.value, wageError: action.error ?? false };
    case "SET_NAME_DRAFT":
      return { ...state, nameDraft: action.value };
    case "SET_NAME_SAVING":
      return { ...state, nameSaving: action.value };
    case "SET_NAME_MESSAGE":
      return { ...state, nameMessage: action.value };
    case "SET_STATE_RESOURCES":
      return { ...state, stateResources: action.value };
    case "SET_EXTRACTION_CAPACITY":
      return { ...state, extractionCapacity: action.value };
    case "SET_EXTRACTION_OPPORTUNITIES":
      return { ...state, extractionOpportunities: action.value };
    case "SET_FOREX_ENABLED":
      return { ...state, forexEnabled: action.value };
    case "SET_EXCHANGE_RATES":
      return { ...state, exchangeRates: action.value };
    case "SET_FOR_SALE_INFO":
      return { ...state, forSaleInfo: action.value };
    case "SET_LISTING_FOR_SALE":
      return { ...state, listingForSale: action.value };
    case "SET_UNLISTING_FOR_SALE":
      return { ...state, unlistingForSale: action.value };
    case "SET_BUYING_SECTOR":
      return { ...state, buyingSector: action.value };
    case "SET_FOR_SALE_MESSAGE":
      return { ...state, forSaleMessage: action.value };
    default:
      return state;
  }
}

export function useSectorPageState(): [SectorPageState, Dispatch<SectorPageAction>] {
  return useReducer(sectorPageReducer, initialState);
}

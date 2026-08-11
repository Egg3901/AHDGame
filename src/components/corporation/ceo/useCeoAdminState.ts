import { useReducer, type Dispatch } from "react";
import type { CommodityType } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

export interface DissolveShareholderRow {
  characterId: string;
  isImperial?: boolean;
  name: string;
  shares: number;
  payout: number;
}

export interface DissolveCorporateShareholderRow {
  corporationId: string;
  name: string;
  shares: number;
  payout: number;
}

export interface DissolvePublicFloatRow {
  shares: number;
  payout: number;
}

export interface DissolvePreviewData {
  outstandingBonds: number;
  canQuickDissolve: boolean;
  /** Turns left before the corp is old enough to dissolve (0 when eligible). */
  dissolutionAgeTurnsRemaining: number;
  /** Total liquidation proceeds (post asset liquidation) in corp local currency. */
  returnedCapitalCorp: number;
  /** Total in CEO's home currency (kept for backward compat — equals the CEO's actual share only on private corps). */
  returnedCapitalHome: number;
  /** CEO's pro-rata share in their home currency. Equals returnedCapitalHome on private corps. */
  ceoShareHome: number;
  /** CEO's pro-rata share in anchor units (₳). */
  ceoShareAnchor: number;
  /** Whether the requesting CEO is the sole shareholder (effectively private even if not flagged). */
  ceoIsSoleShareholder: boolean;
  homeCurrency: string;
  forexEnabled: boolean;
  /** All character/imperial shareholder allocations (anchor units). */
  characterRows: DissolveShareholderRow[];
  /** Corporate equity shareholder allocations (anchor units; credited to corp liquidCapital). */
  corporateRows: DissolveCorporateShareholderRow[];
  /** publicFloat allocation (anchor; routed to country central bank reserve). */
  publicFloatRow: DissolvePublicFloatRow | null;
  commodityGlobalDeltas: Array<{
    commodity: CommodityType;
    label: string;
    priceBefore: number;
    priceAfter: number;
    deltaPct: number;
  }>;
}

export interface StateOption {
  id: string;
  name: string;
}

export interface CeoAdminState {
  // Relocate
  relocateTarget: string;
  relocatePayment: "cash" | "bond";
  relocating: boolean;
  showRelocateConfirm: boolean;
  relocateError: string;
  relocateSuccess: string;
  stateOptions: StateOption[];
  loadingStates: boolean;
  relocateCountry: CountryId;
  // Resign
  resignLoading: boolean;
  resignError: string;
  resignSuccess: string;
  showResignConfirm: boolean;
  // Dissolve
  dissolving: boolean;
  showDissolveConfirm: boolean;
  actionError: string;
  dissolvePreviewLoading: boolean;
  dissolvePreviewError: string;
  dissolvePreview: DissolvePreviewData | null;
  // Legal structure
  selectedStructure: LegalStructureId | "";
  legalStructureLoading: boolean;
  legalStructureError: string;
  legalStructureSuccess: string;
  // Misc
  shareholderAddressOpen: boolean;
}

export type CeoAdminAction =
  | { type: "SET_RELOCATE_TARGET"; value: string }
  | { type: "SET_RELOCATE_PAYMENT"; value: "cash" | "bond" }
  | { type: "SET_RELOCATING"; value: boolean }
  | { type: "SET_SHOW_RELOCATE_CONFIRM"; value: boolean }
  | { type: "SET_RELOCATE_ERROR"; value: string }
  | { type: "SET_RELOCATE_SUCCESS"; value: string }
  | { type: "SET_STATE_OPTIONS"; value: StateOption[] }
  | { type: "SET_LOADING_STATES"; value: boolean }
  | { type: "SET_RELOCATE_COUNTRY"; value: CountryId }
  | { type: "SET_RESIGN_LOADING"; value: boolean }
  | { type: "SET_RESIGN_ERROR"; value: string }
  | { type: "SET_RESIGN_SUCCESS"; value: string }
  | { type: "SET_SHOW_RESIGN_CONFIRM"; value: boolean }
  | { type: "SET_DISSOLVING"; value: boolean }
  | { type: "SET_SHOW_DISSOLVE_CONFIRM"; value: boolean }
  | { type: "SET_ACTION_ERROR"; value: string }
  | { type: "SET_DISSOLVE_PREVIEW_LOADING"; value: boolean }
  | { type: "SET_DISSOLVE_PREVIEW_ERROR"; value: string }
  | { type: "SET_DISSOLVE_PREVIEW"; value: DissolvePreviewData | null }
  | { type: "SET_SELECTED_STRUCTURE"; value: LegalStructureId | "" }
  | { type: "SET_LEGAL_STRUCTURE_LOADING"; value: boolean }
  | { type: "SET_LEGAL_STRUCTURE_ERROR"; value: string }
  | { type: "SET_LEGAL_STRUCTURE_SUCCESS"; value: string }
  | { type: "SET_SHAREHOLDER_ADDRESS_OPEN"; value: boolean };

function makeInitialState(initialCountryId: CountryId): CeoAdminState {
  return {
    relocateTarget: "",
    relocatePayment: "cash",
    relocating: false,
    showRelocateConfirm: false,
    relocateError: "",
    relocateSuccess: "",
    stateOptions: [],
    loadingStates: false,
    relocateCountry: initialCountryId,
    resignLoading: false,
    resignError: "",
    resignSuccess: "",
    showResignConfirm: false,
    dissolving: false,
    showDissolveConfirm: false,
    actionError: "",
    dissolvePreviewLoading: false,
    dissolvePreviewError: "",
    dissolvePreview: null,
    selectedStructure: "",
    legalStructureLoading: false,
    legalStructureError: "",
    legalStructureSuccess: "",
    shareholderAddressOpen: false,
  };
}

export function ceoAdminReducer(state: CeoAdminState, action: CeoAdminAction): CeoAdminState {
  switch (action.type) {
    case "SET_RELOCATE_TARGET":
      return { ...state, relocateTarget: action.value };
    case "SET_RELOCATE_PAYMENT":
      return { ...state, relocatePayment: action.value };
    case "SET_RELOCATING":
      return { ...state, relocating: action.value };
    case "SET_SHOW_RELOCATE_CONFIRM":
      return { ...state, showRelocateConfirm: action.value };
    case "SET_RELOCATE_ERROR":
      return { ...state, relocateError: action.value };
    case "SET_RELOCATE_SUCCESS":
      return { ...state, relocateSuccess: action.value };
    case "SET_STATE_OPTIONS":
      return { ...state, stateOptions: action.value };
    case "SET_LOADING_STATES":
      return { ...state, loadingStates: action.value };
    case "SET_RELOCATE_COUNTRY":
      return { ...state, relocateCountry: action.value };
    case "SET_RESIGN_LOADING":
      return { ...state, resignLoading: action.value };
    case "SET_RESIGN_ERROR":
      return { ...state, resignError: action.value };
    case "SET_RESIGN_SUCCESS":
      return { ...state, resignSuccess: action.value };
    case "SET_SHOW_RESIGN_CONFIRM":
      return { ...state, showResignConfirm: action.value };
    case "SET_DISSOLVING":
      return { ...state, dissolving: action.value };
    case "SET_SHOW_DISSOLVE_CONFIRM":
      return { ...state, showDissolveConfirm: action.value };
    case "SET_ACTION_ERROR":
      return { ...state, actionError: action.value };
    case "SET_DISSOLVE_PREVIEW_LOADING":
      return { ...state, dissolvePreviewLoading: action.value };
    case "SET_DISSOLVE_PREVIEW_ERROR":
      return { ...state, dissolvePreviewError: action.value };
    case "SET_DISSOLVE_PREVIEW":
      return { ...state, dissolvePreview: action.value };
    case "SET_SELECTED_STRUCTURE":
      return { ...state, selectedStructure: action.value };
    case "SET_LEGAL_STRUCTURE_LOADING":
      return { ...state, legalStructureLoading: action.value };
    case "SET_LEGAL_STRUCTURE_ERROR":
      return { ...state, legalStructureError: action.value };
    case "SET_LEGAL_STRUCTURE_SUCCESS":
      return { ...state, legalStructureSuccess: action.value };
    case "SET_SHAREHOLDER_ADDRESS_OPEN":
      return { ...state, shareholderAddressOpen: action.value };
    default:
      return state;
  }
}

export function useCeoAdminState(
  initialCountryId: CountryId
): [CeoAdminState, Dispatch<CeoAdminAction>] {
  return useReducer(ceoAdminReducer, initialCountryId, makeInitialState);
}

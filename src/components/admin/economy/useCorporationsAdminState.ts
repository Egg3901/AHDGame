import { useReducer, type Dispatch } from "react";

export interface CorpRow {
  id: string;
  name: string;
  countryId: string;
  headquartersState: string;
  type: string;
  ceoId: string | null;
  ceoName: string | null;
  ceoVacant: boolean;
  ceoVacantSinceTurn: number | null;
  suspended: boolean;
  suspendedUntilTurn: number | null;
  liquidCapital: number;
  revenue: number;
  dividendRate: number;
  sharePrice: number;
  totalShares: number;
  creditRatingSnapshot: string | null;
  bondDefaultCreditPenaltyUntilTurn: number | null;
  imfBailoutActive: boolean;
  imfFacilityPrincipalOutstanding: number | null;
  imfFacilityAmortizationTurnsRemaining: number | null;
  imfFacilityIncomeCaptureFraction: number | null;
  imfFacilityAnnualRate: number | null;
  imfInstitution: boolean;
}

/** GET /api/admin/corporations/[id]/imf-bailout — preview or active facility readout. */
export type ImfBailoutPreviewResponse =
  | {
      mode: "preview";
      bonds: {
        bondId: string;
        totalIssued: number;
        afterHaircutFace: number;
        couponRate?: number;
      }[];
      facilityPrincipal: number;
      annualRatePercent: number;
      amortizationTurns: number;
      incomeCapturePercent: number;
      incomeCapturePercentMax: number;
      lastReportedTurnIncome: number;
      lastHistoryTurn: number | null;
      scheduledPaymentPerTurn: number;
      incomeCapPerTurn: number;
      simulation: {
        estimatedTurnsToClear: number | null;
        outcome: string;
        principalEnd: number;
        warning: string | null;
      };
      note?: string;
    }
  | {
      mode: "active";
      bonds: unknown[];
      facilityPrincipal: number;
      annualRatePercent: number;
      amortizationTurnsRemaining: number;
      incomeCapturePercent: number;
      incomeCapturePercentStored: number;
      incomeCapturePercentMax: number;
      lastReportedTurnIncome: number;
      lastHistoryTurn: number | null;
      scheduledPaymentPerTurn: number;
      incomeCapPerTurn: number;
      simulation: {
        estimatedTurnsToClear: number | null;
        outcome: string;
        principalEnd: number;
        warning: string | null;
      };
    };

export interface Summary {
  total: number;
  active: number;
  suspended: number;
  ceoVacancies: number;
  totalLiquidCapital: number;
}

export type ConfirmAction = {
  type: "resetTimers" | "forceDividend" | "vacateCeo" | "suspend" | "resume" | "forceLiquidate";
  corpId: string;
  corpName: string;
} | null;

export type InlinePanel = {
  type: "capital" | "appointCeo" | "hq" | "imf" | "spawnNpp";
  corpId: string;
} | null;

export interface CorporationsAdminState {
  summary: Summary | null;
  corps: CorpRow[];
  loading: boolean;
  error: string | null;
  actionError: string | null;
  actionLoading: string | null;
  currentTurn: number;
  confirm: ConfirmAction;
  inline: InlinePanel;
  globalConfirm: "resetAll" | "resumeAll" | "spawnUnowned" | null;
  spawnUnownedLog: string | null;
  capitalAmount: string;
  hqCountry: string;
  hqRegion: string;
  appointedCharId: string | null;
  appointedCharName: string | null;
  imfTargetPct: string;
  imfAnnualRate: string;
  imfTurns: string;
  imfRetention: string;
  imfIncomeCapture: string;
  imfPreview: ImfBailoutPreviewResponse | null;
  imfPreviewLoading: boolean;
  imfPreviewError: string | null;
  spawnNppForm: {
    name: string;
    type: string;
    countryId: string;
    headquartersState: string;
    startingCapital: string;
    startingRevenue: string;
    profitMargin: string;
    brandColor: string;
  };
  spawnNppResult: {
    success: boolean;
    corporationId?: string;
    sequentialId?: number;
    name?: string;
    error?: string;
  } | null;
  spawnNppLoading: boolean;
}

export type CorporationsAdminAction =
  | { type: "SET_SUMMARY"; value: Summary | null }
  | { type: "SET_CORPS"; value: CorpRow[] }
  | { type: "SET_LOADING"; value: boolean }
  | { type: "SET_ERROR"; value: string | null }
  | { type: "SET_ACTION_ERROR"; value: string | null }
  | { type: "SET_ACTION_LOADING"; value: string | null }
  | { type: "SET_CURRENT_TURN"; value: number }
  | { type: "SET_CONFIRM"; value: ConfirmAction }
  | { type: "SET_INLINE"; value: InlinePanel }
  | { type: "SET_GLOBAL_CONFIRM"; value: "resetAll" | "resumeAll" | "spawnUnowned" | null }
  | { type: "SET_SPAWN_UNOWNED_LOG"; value: string | null }
  | { type: "SET_CAPITAL_AMOUNT"; value: string }
  | { type: "SET_HQ_COUNTRY"; value: string }
  | { type: "SET_HQ_REGION"; value: string }
  | { type: "SET_APPOINTED_CHAR_ID"; value: string | null }
  | { type: "SET_APPOINTED_CHAR_NAME"; value: string | null }
  | { type: "SET_IMF_TARGET_PCT"; value: string }
  | { type: "SET_IMF_ANNUAL_RATE"; value: string }
  | { type: "SET_IMF_TURNS"; value: string }
  | { type: "SET_IMF_RETENTION"; value: string }
  | { type: "SET_IMF_INCOME_CAPTURE"; value: string }
  | { type: "SET_IMF_PREVIEW"; value: ImfBailoutPreviewResponse | null }
  | { type: "SET_IMF_PREVIEW_LOADING"; value: boolean }
  | { type: "SET_IMF_PREVIEW_ERROR"; value: string | null }
  | { type: "SET_SPAWN_NPP_FORM"; value: Partial<CorporationsAdminState["spawnNppForm"]> }
  | { type: "SET_SPAWN_NPP_RESULT"; value: CorporationsAdminState["spawnNppResult"] }
  | { type: "SET_SPAWN_NPP_LOADING"; value: boolean };

const initialState: CorporationsAdminState = {
  summary: null,
  corps: [],
  loading: true,
  error: null,
  actionError: null,
  actionLoading: null,
  currentTurn: 0,
  confirm: null,
  inline: null,
  globalConfirm: null,
  spawnUnownedLog: null,
  capitalAmount: "",
  hqCountry: "US",
  hqRegion: "",
  appointedCharId: null,
  appointedCharName: null,
  imfTargetPct: "40",
  imfAnnualRate: "6",
  imfTurns: "240",
  imfRetention: "0.7",
  imfIncomeCapture: "35",
  imfPreview: null,
  imfPreviewLoading: false,
  imfPreviewError: null,
  spawnNppForm: {
    name: "",
    type: "technology",
    countryId: "US",
    headquartersState: "",
    startingCapital: "1000000",
    startingRevenue: "",
    profitMargin: "35",
    brandColor: "",
  },
  spawnNppResult: null,
  spawnNppLoading: false,
};

export function corporationsAdminReducer(
  state: CorporationsAdminState,
  action: CorporationsAdminAction
): CorporationsAdminState {
  switch (action.type) {
    case "SET_SUMMARY":
      return { ...state, summary: action.value };
    case "SET_CORPS":
      return { ...state, corps: action.value };
    case "SET_LOADING":
      return { ...state, loading: action.value };
    case "SET_ERROR":
      return { ...state, error: action.value };
    case "SET_ACTION_ERROR":
      return { ...state, actionError: action.value };
    case "SET_ACTION_LOADING":
      return { ...state, actionLoading: action.value };
    case "SET_CURRENT_TURN":
      return { ...state, currentTurn: action.value };
    case "SET_CONFIRM":
      return { ...state, confirm: action.value };
    case "SET_INLINE":
      return { ...state, inline: action.value };
    case "SET_GLOBAL_CONFIRM":
      return { ...state, globalConfirm: action.value };
    case "SET_SPAWN_UNOWNED_LOG":
      return { ...state, spawnUnownedLog: action.value };
    case "SET_CAPITAL_AMOUNT":
      return { ...state, capitalAmount: action.value };
    case "SET_HQ_COUNTRY":
      return { ...state, hqCountry: action.value };
    case "SET_HQ_REGION":
      return { ...state, hqRegion: action.value };
    case "SET_APPOINTED_CHAR_ID":
      return { ...state, appointedCharId: action.value };
    case "SET_APPOINTED_CHAR_NAME":
      return { ...state, appointedCharName: action.value };
    case "SET_IMF_TARGET_PCT":
      return { ...state, imfTargetPct: action.value };
    case "SET_IMF_ANNUAL_RATE":
      return { ...state, imfAnnualRate: action.value };
    case "SET_IMF_TURNS":
      return { ...state, imfTurns: action.value };
    case "SET_IMF_RETENTION":
      return { ...state, imfRetention: action.value };
    case "SET_IMF_INCOME_CAPTURE":
      return { ...state, imfIncomeCapture: action.value };
    case "SET_IMF_PREVIEW":
      return { ...state, imfPreview: action.value };
    case "SET_IMF_PREVIEW_LOADING":
      return { ...state, imfPreviewLoading: action.value };
    case "SET_IMF_PREVIEW_ERROR":
      return { ...state, imfPreviewError: action.value };
    case "SET_SPAWN_NPP_FORM":
      return { ...state, spawnNppForm: { ...state.spawnNppForm, ...action.value } };
    case "SET_SPAWN_NPP_RESULT":
      return { ...state, spawnNppResult: action.value };
    case "SET_SPAWN_NPP_LOADING":
      return { ...state, spawnNppLoading: action.value };
    default:
      return state;
  }
}

export function useCorporationsAdminState(): [
  CorporationsAdminState,
  Dispatch<CorporationsAdminAction>,
] {
  return useReducer(corporationsAdminReducer, initialState);
}

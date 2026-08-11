import { useCallback, useReducer } from "react";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CorporationDetail } from "../CorporationPageTypes";

/**
 * Consolidated CEO Office form state (settings, budgets, dividends, uploads),
 * shared by the classic and command-center variants of CeoOfficeTab.
 *
 * useReducer with a patch action per project convention for components with
 * many state fields (model: src/components/officials/useOfficialsState.ts).
 * Every field previously lived in its own useState with a plain
 * `(val) => void` setter, so a shallow-merge patch preserves semantics
 * exactly (no consumer uses functional updates).
 */
export interface CeoOfficeState {
  // Settings form
  editDescription: string;
  editMarketingBudget: string;
  editLogisticsBudget: string;
  editRdBudget: string;
  editCeoSalary: number;
  editShareBuybackMode: "instant" | "escrow";
  editEscrowFundingPerTurn: string;
  editBrandColor: string;
  editPrimaryType: CorporationType;
  editSecondaryType: CorporationType | "";
  saving: boolean;
  actionError: string;
  actionSuccess: string;

  // Dividends
  editDividendRate: number;
  dividendSaving: boolean;
  dividendError: string;
  dividendSuccess: string;

  // Uploads
  uploadingLogo: boolean;
  uploadingHeader: boolean;
  uploadError: string;
}

function initCeoOfficeState(corporation: CorporationDetail): CeoOfficeState {
  return {
    editDescription: corporation.description || "",
    editMarketingBudget: String(corporation.marketingBudget),
    editLogisticsBudget: String(corporation.logisticsBudget ?? 0),
    editRdBudget: String(corporation.rdBudget ?? 0),
    editCeoSalary: corporation.ceoSalary ?? 0,
    editShareBuybackMode: corporation.shareBuybackMode ?? "instant",
    editEscrowFundingPerTurn: String(corporation.escrowFundingPerTurn ?? 0),
    editBrandColor: corporation.brandColor ?? "#3b82f6",
    editPrimaryType: corporation.type,
    editSecondaryType: corporation.secondaryType ?? "",
    saving: false,
    actionError: "",
    actionSuccess: "",
    editDividendRate: corporation.dividendRate ?? 0,
    dividendSaving: false,
    dividendError: "",
    dividendSuccess: "",
    uploadingLogo: false,
    uploadingHeader: false,
    uploadError: "",
  };
}

function reducer(state: CeoOfficeState, patch: Partial<CeoOfficeState>): CeoOfficeState {
  return { ...state, ...patch };
}

/**
 * Returns the consolidated state plus a stable `set` that shallow-merges a
 * partial patch — `set({ saving: true })` replaces the old `setSaving(true)`.
 */
export function useCeoOfficeState(
  corporation: CorporationDetail
): [CeoOfficeState, (patch: Partial<CeoOfficeState>) => void] {
  const [state, dispatch] = useReducer(reducer, corporation, initCeoOfficeState);
  const set = useCallback((patch: Partial<CeoOfficeState>) => dispatch(patch), []);
  return [state, set];
}

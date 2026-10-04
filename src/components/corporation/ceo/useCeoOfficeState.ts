import { useCallback, useReducer } from "react";
import type { CorporationDetail } from "../CorporationPageTypes";

/**
 * CEO Office form state: operating budgets, buyback settings and dividends.
 *
 * useReducer with a patch action per project convention for components with
 * many state fields (model: src/components/officials/useOfficialsState.ts).
 * Identity settings (description, colour, sector types, uploads) live in the
 * settings modal, which keeps its own state.
 */
export interface CeoOfficeState {
  editMarketingBudget: string;
  editLogisticsBudget: string;
  editRdBudget: string;
  editCeoSalary: number;
  editShareBuybackMode: "instant" | "escrow";
  editEscrowFundingPerTurn: string;
  saving: boolean;
  actionError: string;
  actionSuccess: string;

  editDividendRate: number;
  dividendSaving: boolean;
  dividendError: string;
  dividendSuccess: string;
}

function initCeoOfficeState(corporation: CorporationDetail): CeoOfficeState {
  return {
    editMarketingBudget: String(corporation.marketingBudget),
    editLogisticsBudget: String(corporation.logisticsBudget ?? 0),
    editRdBudget: String(corporation.rdBudget ?? 0),
    editCeoSalary: corporation.ceoSalary ?? 0,
    editShareBuybackMode: corporation.shareBuybackMode ?? "instant",
    editEscrowFundingPerTurn: String(corporation.escrowFundingPerTurn ?? 0),
    saving: false,
    actionError: "",
    actionSuccess: "",
    editDividendRate: corporation.dividendRate ?? 0,
    dividendSaving: false,
    dividendError: "",
    dividendSuccess: "",
  };
}

function reducer(state: CeoOfficeState, patch: Partial<CeoOfficeState>): CeoOfficeState {
  return { ...state, ...patch };
}

/**
 * Returns the state plus a stable `set` that shallow-merges a partial patch,
 * so `set({ saving: true })` replaces a `setSaving(true)`.
 */
export function useCeoOfficeState(
  corporation: CorporationDetail
): [CeoOfficeState, (patch: Partial<CeoOfficeState>) => void] {
  const [state, dispatch] = useReducer(reducer, corporation, initCeoOfficeState);
  const set = useCallback((patch: Partial<CeoOfficeState>) => dispatch(patch), []);
  return [state, set];
}

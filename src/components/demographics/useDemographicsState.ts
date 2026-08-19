import { useReducer } from "react";
import type { CategoryWeights, DemographicCategoryId } from "@/lib/db/types";

interface DemographicGroup {
  id: string;
  name: string;
  defaultEconomicLean: number;
  defaultSocialLean: number;
}

export interface DemographicCategory {
  _id: DemographicCategoryId;
  name: string;
  groups: DemographicGroup[];
  defaultWeight: number;
}

export interface StateDemographicGroup {
  population: number;
  economicLean: number;
  socialLean: number;
}

interface DemographicsState {
  categories: DemographicCategory[];
  selectedState: string;
  loading: boolean;
  message: string;
  expandedCategories: Set<string>;
  editWeights: CategoryWeights | null;
  editGroups: Record<string, StateDemographicGroup> | null;
  showOverwriteConfirm: boolean;
  overwriteConfirmText: string;
  overwriteLoading: boolean;
  overwriteMessage: string;
  reseedLoading: boolean;
  reseedMessage: string;
}

type Action =
  | { type: "SET_CATEGORIES"; payload: DemographicCategory[] }
  | { type: "SET_SELECTED_STATE"; payload: string }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_MESSAGE"; payload: string }
  | { type: "TOGGLE_CATEGORY"; catId: string }
  | { type: "SET_EDIT"; weights: CategoryWeights; groups: Record<string, StateDemographicGroup> }
  | { type: "CLEAR_EDIT" }
  | { type: "SET_OVERWRITE_CONFIRM"; payload: boolean }
  | { type: "SET_OVERWRITE_CONFIRM_TEXT"; payload: string }
  | { type: "SET_OVERWRITE_LOADING"; payload: boolean }
  | { type: "SET_OVERWRITE_MESSAGE"; payload: string }
  | { type: "CLOSE_OVERWRITE" }
  | { type: "SET_RESEED_LOADING"; payload: boolean }
  | { type: "SET_RESEED_MESSAGE"; payload: string };

const initialState: DemographicsState = {
  categories: [],
  selectedState: "",
  loading: false,
  message: "",
  expandedCategories: new Set(),
  editWeights: null,
  editGroups: null,
  showOverwriteConfirm: false,
  overwriteConfirmText: "",
  overwriteLoading: false,
  overwriteMessage: "",
  reseedLoading: false,
  reseedMessage: "",
};

function reducer(state: DemographicsState, action: Action): DemographicsState {
  switch (action.type) {
    case "SET_CATEGORIES":
      return { ...state, categories: action.payload };
    case "SET_SELECTED_STATE":
      return { ...state, selectedState: action.payload };
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "SET_MESSAGE":
      return { ...state, message: action.payload };
    case "TOGGLE_CATEGORY": {
      const next = new Set(state.expandedCategories);
      if (next.has(action.catId)) next.delete(action.catId);
      else next.add(action.catId);
      return { ...state, expandedCategories: next };
    }
    case "SET_EDIT":
      return { ...state, editWeights: action.weights, editGroups: action.groups };
    case "CLEAR_EDIT":
      return { ...state, editWeights: null, editGroups: null };
    case "SET_OVERWRITE_CONFIRM":
      return { ...state, showOverwriteConfirm: action.payload };
    case "SET_OVERWRITE_CONFIRM_TEXT":
      return { ...state, overwriteConfirmText: action.payload };
    case "SET_OVERWRITE_LOADING":
      return { ...state, overwriteLoading: action.payload };
    case "SET_OVERWRITE_MESSAGE":
      return { ...state, overwriteMessage: action.payload };
    case "CLOSE_OVERWRITE":
      return {
        ...state,
        showOverwriteConfirm: false,
        overwriteConfirmText: "",
        overwriteMessage: "",
      };
    case "SET_RESEED_LOADING":
      return { ...state, reseedLoading: action.payload };
    case "SET_RESEED_MESSAGE":
      return { ...state, reseedMessage: action.payload };
    default:
      return state;
  }
}

export function useDemographicsState() {
  return useReducer(reducer, initialState);
}

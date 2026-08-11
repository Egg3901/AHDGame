// Reducer-managed state for the admin Wiki Management tab. Replaces the
// 19 useState calls in WikiManagementTab.tsx with a single dispatch.
//
// Modelled after src/components/navbar/useNavbarState.ts: flat state shape so
// the call-site diff stays small (every former useState becomes a state field
// of the same name; every former setter becomes a dispatch).

import { useReducer, type Dispatch } from "react";

export interface WikiPageItem {
  _id: string;
  slug: string;
  title: string;
  description: string;
  content: string;
  featured?: boolean;
}

export type ReseedMode = "" | "reseed" | "force";

export interface FormSnapshot {
  slug: string;
  title: string;
  description: string;
  content: string;
  featured: boolean;
}

export interface WikiManagementState {
  pages: WikiPageItem[];
  loading: boolean;
  error: string;
  creating: boolean;
  editingSlug: string | null;
  formSlug: string;
  formTitle: string;
  formDescription: string;
  formContent: string;
  formFeatured: boolean;
  saving: boolean;
  reseedMode: ReseedMode;
  reseedMessage: string;
  syncing: boolean;
  syncMessage: string;
  backfilling: boolean;
  backfillMessage: string;
  wikiDisabled: boolean;
  togglingWiki: boolean;
}

export type WikiManagementAction =
  | { type: "SET_PAGES"; pages: WikiPageItem[] }
  | { type: "SET_LOADING"; value: boolean }
  | { type: "SET_ERROR"; value: string }
  | { type: "RESET_FORM" }
  | { type: "START_CREATE" }
  | { type: "START_EDIT"; snapshot: FormSnapshot }
  | { type: "SET_FORM_SLUG"; value: string }
  | { type: "SET_FORM_TITLE"; value: string }
  | { type: "SET_FORM_DESCRIPTION"; value: string }
  | { type: "SET_FORM_CONTENT"; value: string }
  | { type: "SET_FORM_FEATURED"; value: boolean }
  | { type: "SET_SAVING"; value: boolean }
  | { type: "SET_RESEED_MODE"; value: ReseedMode }
  | { type: "SET_RESEED_MESSAGE"; value: string }
  | { type: "SET_SYNCING"; value: boolean }
  | { type: "SET_SYNC_MESSAGE"; value: string }
  | { type: "SET_BACKFILLING"; value: boolean }
  | { type: "SET_BACKFILL_MESSAGE"; value: string }
  | { type: "SET_WIKI_DISABLED"; value: boolean }
  | { type: "SET_TOGGLING_WIKI"; value: boolean };

export const initialWikiManagementState: WikiManagementState = {
  pages: [],
  loading: true,
  error: "",
  creating: false,
  editingSlug: null,
  formSlug: "",
  formTitle: "",
  formDescription: "",
  formContent: "",
  formFeatured: false,
  saving: false,
  reseedMode: "",
  reseedMessage: "",
  syncing: false,
  syncMessage: "",
  backfilling: false,
  backfillMessage: "",
  wikiDisabled: false,
  togglingWiki: false,
};

const EMPTY_FORM = {
  formSlug: "",
  formTitle: "",
  formDescription: "",
  formContent: "",
  formFeatured: false,
  creating: false,
  editingSlug: null as string | null,
};

export function wikiManagementReducer(
  state: WikiManagementState,
  action: WikiManagementAction
): WikiManagementState {
  switch (action.type) {
    case "SET_PAGES":
      return { ...state, pages: action.pages };
    case "SET_LOADING":
      return { ...state, loading: action.value };
    case "SET_ERROR":
      return { ...state, error: action.value };
    case "RESET_FORM":
      return { ...state, ...EMPTY_FORM };
    case "START_CREATE":
      return { ...state, ...EMPTY_FORM, creating: true };
    case "START_EDIT":
      return {
        ...state,
        formSlug: action.snapshot.slug,
        formTitle: action.snapshot.title,
        formDescription: action.snapshot.description,
        formContent: action.snapshot.content,
        formFeatured: action.snapshot.featured,
        editingSlug: action.snapshot.slug,
        creating: false,
      };
    case "SET_FORM_SLUG":
      return { ...state, formSlug: action.value };
    case "SET_FORM_TITLE":
      return { ...state, formTitle: action.value };
    case "SET_FORM_DESCRIPTION":
      return { ...state, formDescription: action.value };
    case "SET_FORM_CONTENT":
      return { ...state, formContent: action.value };
    case "SET_FORM_FEATURED":
      return { ...state, formFeatured: action.value };
    case "SET_SAVING":
      return { ...state, saving: action.value };
    case "SET_RESEED_MODE":
      return { ...state, reseedMode: action.value };
    case "SET_RESEED_MESSAGE":
      return { ...state, reseedMessage: action.value };
    case "SET_SYNCING":
      return { ...state, syncing: action.value };
    case "SET_SYNC_MESSAGE":
      return { ...state, syncMessage: action.value };
    case "SET_BACKFILLING":
      return { ...state, backfilling: action.value };
    case "SET_BACKFILL_MESSAGE":
      return { ...state, backfillMessage: action.value };
    case "SET_WIKI_DISABLED":
      return { ...state, wikiDisabled: action.value };
    case "SET_TOGGLING_WIKI":
      return { ...state, togglingWiki: action.value };
    default:
      return state;
  }
}

export function useWikiManagementState(): [WikiManagementState, Dispatch<WikiManagementAction>] {
  return useReducer(wikiManagementReducer, initialWikiManagementState);
}

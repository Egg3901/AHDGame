import { useReducer } from "react";

export interface WikiEditorState {
  content: string;
  title: string;
  description: string;
  slug: string;
  category: string;
  tags: string[];
  selectedTemplate: string | null;
  difficulty: "beginner" | "intermediate" | "advanced" | null;
  featured: boolean;
  private: boolean;
  isDirty: boolean;
  isSaving: boolean;
  errors: Record<string, string>;
}

export type WikiEditorAction =
  | {
      type: "SET_FIELD";
      field: keyof WikiEditorState;
      value: WikiEditorState[keyof WikiEditorState];
    }
  | { type: "SET_TEMPLATE"; template: string; sections: string }
  | { type: "SET_ERRORS"; errors: Record<string, string> }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_SUCCESS" }
  | { type: "SUBMIT_ERROR"; error: string }
  | { type: "LOAD_DRAFT"; draft: Partial<WikiEditorState> }
  | { type: "RESET" };

const initialState: WikiEditorState = {
  content: "",
  title: "",
  description: "",
  slug: "",
  category: "",
  tags: [],
  selectedTemplate: null,
  difficulty: null,
  featured: false,
  private: false,
  isDirty: false,
  isSaving: false,
  errors: {},
};

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function reducer(state: WikiEditorState, action: WikiEditorAction): WikiEditorState {
  switch (action.type) {
    case "SET_FIELD": {
      const newState = {
        ...state,
        [action.field]: action.value,
        isDirty: true,
      };

      // Auto-generate slug when title changes
      if (action.field === "title") {
        newState.slug = generateSlug(action.value as string);
      }

      return newState;
    }

    case "SET_TEMPLATE":
      return {
        ...state,
        selectedTemplate: action.template,
        content: action.sections,
        isDirty: true,
      };

    case "SET_ERRORS":
      return {
        ...state,
        errors: action.errors,
      };

    case "SUBMIT_START":
      return {
        ...state,
        isSaving: true,
        errors: {},
      };

    case "SUBMIT_SUCCESS":
      return {
        ...state,
        isSaving: false,
        isDirty: false,
      };

    case "SUBMIT_ERROR":
      return {
        ...state,
        isSaving: false,
        errors: { _form: action.error },
      };

    case "LOAD_DRAFT":
      return {
        ...state,
        ...action.draft,
        isDirty: true,
      };

    case "RESET":
      return initialState;

    default:
      return state;
  }
}

export function useWikiEditorState() {
  const [state, dispatch] = useReducer(reducer, initialState);
  return { state, dispatch };
}

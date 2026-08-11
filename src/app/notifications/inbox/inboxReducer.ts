export type InboxState = {
  seg: "all" | "action" | "notifs" | "mail";
  selId: string | null;
  density: "comfortable" | "compact";
  grouping: "grouped" | "flat";
  readIds: Set<string>;
  archivedIds: Set<string>;
  snoozedIds: Set<string>;
};

export type InboxAction =
  | { type: "SET_SEG"; seg: "all" | "action" | "notifs" | "mail" }
  | { type: "SELECT"; id: string | null }
  | { type: "SET_DENSITY"; density: "comfortable" | "compact" }
  | { type: "SET_GROUPING"; grouping: "grouped" | "flat" }
  | { type: "MARK_READ"; id: string }
  | { type: "MARK_ALL_READ"; ids: string[] }
  | { type: "ARCHIVE"; id: string }
  | { type: "SNOOZE"; id: string };

export const initialInboxState: InboxState = {
  seg: "action",
  selId: null,
  density: "comfortable",
  grouping: "grouped",
  readIds: new Set(),
  archivedIds: new Set(),
  snoozedIds: new Set(),
};

export function inboxReducer(state: InboxState, action: InboxAction): InboxState {
  switch (action.type) {
    case "SET_SEG":
      return {
        ...state,
        seg: action.seg,
        selId: null,
      };

    case "SELECT":
      return {
        ...state,
        selId: action.id,
      };

    case "SET_DENSITY":
      return {
        ...state,
        density: action.density,
      };

    case "SET_GROUPING":
      return {
        ...state,
        grouping: action.grouping,
      };

    case "MARK_READ":
      return {
        ...state,
        readIds: new Set(state.readIds).add(action.id),
      };

    case "MARK_ALL_READ":
      return {
        ...state,
        readIds: new Set([...state.readIds, ...action.ids]),
      };

    case "ARCHIVE":
      return {
        ...state,
        archivedIds: new Set(state.archivedIds).add(action.id),
        selId: null,
      };

    case "SNOOZE":
      return {
        ...state,
        snoozedIds: new Set(state.snoozedIds).add(action.id),
      };

    default:
      const _exhaustive: never = action;
      return _exhaustive;
  }
}

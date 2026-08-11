// Reducer-managed state for the top navbar. Replaces the 12 useState calls in
// Navbar.tsx with a single dispatch. Flat state shape keeps the diff in
// Navbar small — every former useState becomes a state field of the same
// name, every former setter becomes a dispatch.
//
// Modelled after src/components/officials/useOfficialsState.ts.

import { useReducer, type Dispatch } from "react";

export interface NotificationPreview {
  _id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  type: string;
}

export type NavbarDropdownKey =
  "state" | "nation" | "world" | "account" | "help" | "profile" | "staff";

export type NavbarSwitchingKey = "character" | "imperial";

export type NavbarPopoverKey = "search" | "notif";

export interface NavbarState {
  mobileMenuOpen: boolean;
  stateOpen: boolean;
  nationOpen: boolean;
  worldOpen: boolean;
  accountOpen: boolean;
  helpOpen: boolean;
  profileOpen: boolean;
  staffOpen: boolean;
  switchingCharacter: boolean;
  switchingImperial: boolean;
  searchOpen: boolean;
  notifOpen: boolean;
  notifPreviews: NotificationPreview[];
}

export type NavbarAction =
  | { type: "SET_MOBILE_MENU"; open: boolean }
  | { type: "TOGGLE_DROPDOWN"; key: NavbarDropdownKey }
  | { type: "CLOSE_DROPDOWN"; key: NavbarDropdownKey }
  | { type: "CLOSE_ALL_DROPDOWNS" }
  | { type: "SET_SWITCHING"; key: NavbarSwitchingKey; value: boolean }
  | { type: "SET_POPOVER"; key: NavbarPopoverKey; open: boolean }
  | { type: "SET_NOTIF_PREVIEWS"; items: NotificationPreview[] }
  | { type: "MARK_PREVIEW_READ"; id: string }
  | { type: "REMOVE_PREVIEW"; id: string };

const DROPDOWN_FIELD: Record<NavbarDropdownKey, keyof NavbarState> = {
  state: "stateOpen",
  nation: "nationOpen",
  world: "worldOpen",
  account: "accountOpen",
  help: "helpOpen",
  profile: "profileOpen",
  staff: "staffOpen",
};

const POPOVER_FIELD: Record<NavbarPopoverKey, keyof NavbarState> = {
  search: "searchOpen",
  notif: "notifOpen",
};

const SWITCHING_FIELD: Record<NavbarSwitchingKey, keyof NavbarState> = {
  character: "switchingCharacter",
  imperial: "switchingImperial",
};

export const initialNavbarState: NavbarState = {
  mobileMenuOpen: false,
  stateOpen: false,
  nationOpen: false,
  worldOpen: false,
  accountOpen: false,
  helpOpen: false,
  profileOpen: false,
  staffOpen: false,
  switchingCharacter: false,
  switchingImperial: false,
  searchOpen: false,
  notifOpen: false,
  notifPreviews: [],
};

export function navbarReducer(state: NavbarState, action: NavbarAction): NavbarState {
  switch (action.type) {
    case "SET_MOBILE_MENU":
      return { ...state, mobileMenuOpen: action.open };
    case "TOGGLE_DROPDOWN": {
      const field = DROPDOWN_FIELD[action.key];
      return { ...state, [field]: !state[field] };
    }
    case "CLOSE_DROPDOWN": {
      const field = DROPDOWN_FIELD[action.key];
      return { ...state, [field]: false };
    }
    case "CLOSE_ALL_DROPDOWNS":
      return {
        ...state,
        stateOpen: false,
        nationOpen: false,
        worldOpen: false,
        accountOpen: false,
        helpOpen: false,
        profileOpen: false,
        staffOpen: false,
      };
    case "SET_SWITCHING": {
      const field = SWITCHING_FIELD[action.key];
      return { ...state, [field]: action.value };
    }
    case "SET_POPOVER": {
      const field = POPOVER_FIELD[action.key];
      return { ...state, [field]: action.open };
    }
    case "SET_NOTIF_PREVIEWS":
      return { ...state, notifPreviews: action.items };
    case "MARK_PREVIEW_READ":
      return {
        ...state,
        notifPreviews: state.notifPreviews.map((n) =>
          n._id === action.id ? { ...n, read: true } : n
        ),
      };
    case "REMOVE_PREVIEW":
      return {
        ...state,
        notifPreviews: state.notifPreviews.filter((n) => n._id !== action.id),
      };
    default:
      return state;
  }
}

export function useNavbarState(): [NavbarState, Dispatch<NavbarAction>] {
  return useReducer(navbarReducer, initialNavbarState);
}

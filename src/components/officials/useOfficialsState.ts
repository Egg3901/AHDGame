import { useReducer, Dispatch } from "react";

interface OfficialsStatus {
  totalOfficials: number;
  totalVacant: number;
  byOfficeType: Record<string, number>;
  initialized?: boolean;
  summary: {
    total: number;
    filled: number;
    vacant: number;
  };
}

interface Character {
  _id: string;
  name: string;
  party: string;
  homeState: string;
  currentOffice?: string | null;
}

interface ElectedOfficial {
  _id: string;
  characterId: string | null;
  characterName?: string;
  party?: string;
  state?: string;
  officeType: string;
  senateClass?: number;
  district?: number;
  seatsHeld?: number;
}

interface OfficialsState {
  // Data
  status: OfficialsStatus | null;
  characters: Character[];
  officials: ElectedOfficial[];

  // UI state
  loading: boolean;
  message: string;

  // Filters
  selectedState: string;
  selectedOfficeType: string;
  showOnlyVacant: boolean;

  // Appointment modal
  appointingOfficial: ElectedOfficial | null;
  selectedCharacterId: string;

  // House form
  showHouseForm: boolean;
  houseState: string;
  houseSeats: number;
  houseCharacterId: string;

  // Cleanup
  cleanupResult: { ok: boolean; message: string; details?: Record<string, number> } | null;
}

type OfficialsAction =
  | { type: "SET_STATUS"; payload: OfficialsStatus }
  | { type: "SET_CHARACTERS"; payload: Character[] }
  | { type: "SET_OFFICIALS"; payload: ElectedOfficial[] }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_MESSAGE"; payload: string }
  | { type: "SET_FILTER"; filter: "state" | "officeType" | "vacant"; value: string | boolean }
  | { type: "OPEN_APPOINTMENT_MODAL"; official: ElectedOfficial }
  | { type: "CLOSE_APPOINTMENT_MODAL" }
  | { type: "SET_SELECTED_CHARACTER"; id: string }
  | { type: "OPEN_HOUSE_FORM" }
  | { type: "CLOSE_HOUSE_FORM" }
  | { type: "SET_HOUSE_STATE"; state: string }
  | { type: "SET_HOUSE_SEATS"; seats: number }
  | { type: "SET_HOUSE_CHARACTER"; id: string }
  | { type: "SET_CLEANUP_RESULT"; result: OfficialsState["cleanupResult"] }
  | { type: "RESET_FILTERS" };

function officialsReducer(state: OfficialsState, action: OfficialsAction): OfficialsState {
  switch (action.type) {
    case "SET_STATUS":
      return { ...state, status: action.payload };
    case "SET_CHARACTERS":
      return { ...state, characters: action.payload };
    case "SET_OFFICIALS":
      return { ...state, officials: action.payload };
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "SET_MESSAGE":
      return { ...state, message: action.payload };
    case "SET_FILTER":
      switch (action.filter) {
        case "state":
          return { ...state, selectedState: action.value as string };
        case "officeType":
          return { ...state, selectedOfficeType: action.value as string };
        case "vacant":
          return { ...state, showOnlyVacant: action.value as boolean };
      }
    case "OPEN_APPOINTMENT_MODAL":
      return { ...state, appointingOfficial: action.official, selectedCharacterId: "" };
    case "CLOSE_APPOINTMENT_MODAL":
      return { ...state, appointingOfficial: null, selectedCharacterId: "" };
    case "SET_SELECTED_CHARACTER":
      return { ...state, selectedCharacterId: action.id };
    case "OPEN_HOUSE_FORM":
      return { ...state, showHouseForm: true, houseState: "", houseSeats: 1, houseCharacterId: "" };
    case "CLOSE_HOUSE_FORM":
      return { ...state, showHouseForm: false };
    case "SET_HOUSE_STATE":
      return { ...state, houseState: action.state };
    case "SET_HOUSE_SEATS":
      return { ...state, houseSeats: action.seats };
    case "SET_HOUSE_CHARACTER":
      return { ...state, houseCharacterId: action.id };
    case "SET_CLEANUP_RESULT":
      return { ...state, cleanupResult: action.result };
    case "RESET_FILTERS":
      return { ...state, selectedState: "", selectedOfficeType: "", showOnlyVacant: false };
    default:
      return state;
  }
}

const initialState: OfficialsState = {
  status: null,
  characters: [],
  officials: [],
  loading: false,
  message: "",
  selectedState: "",
  selectedOfficeType: "",
  showOnlyVacant: false,
  appointingOfficial: null,
  selectedCharacterId: "",
  showHouseForm: false,
  houseState: "",
  houseSeats: 1,
  houseCharacterId: "",
  cleanupResult: null,
};

export function useOfficialsState(): [OfficialsState, Dispatch<OfficialsAction>] {
  return useReducer(officialsReducer, initialState);
}

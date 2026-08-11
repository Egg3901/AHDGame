import { UK_COMMONS_CYCLE_PERIOD_HOURS } from "@/lib/constants/turnTime";
import {
  DEFAULT_CYCLE_ANCHOR_CONTEXT,
  getCycleAnchors,
  type CycleAnchorContext,
} from "@/lib/elections/cycleAnchorContext";
import { getLandtagAnchor } from "@/lib/seeds/de/deLandtag";

export type ElectionTypeFilter =
  | ""
  | "senate"
  | "house"
  | "governor"
  | "stateSenate"
  | "commons"
  | "snap_commons"
  | "regionalCouncil"
  | "president"
  | "shugiin"
  | "sangiin"
  | "snap_shugiin"
  | "bundestag"
  | "snap_bundestag"
  | "landtag"
  | "ministerPresident"
  | "npcDelegate"
  | "peoplesCongress"
  | "dail"
  | "seanad"
  | "uachtaran"
  | "localCouncil";
export type CountryFilter = "" | "US" | "UK" | "DE" | "JP" | "CN" | "IE";
export type CountrySelection = "global" | "US" | "UK" | "DE" | "JP" | "CN" | "IE";

export interface ElectionData {
  _id: string;
  electionType:
    | "senate"
    | "house"
    | "governor"
    | "stateSenate"
    | "commons"
    | "snap_commons"
    | "regionalCouncil"
    | "president"
    | "shugiin"
    | "sangiin"
    | "snap_shugiin"
    | "bundestag"
    | "snap_bundestag"
    | "landtag"
    | "npcDelegate"
    | "peoplesCongress"
    | "supremeSovietDeputy"
    | "nationalitiesDeputy"
    | "republicSupremeSoviet"
    | "volkskammerDeputy"
    | "dail"
    | "seanad"
    | "uachtaran"
    | "localCouncil";
  state: string;
  countryId?: string;
  senateClass?: number;
  chamberClass?: number;
  cycle: number;
  status: string;
  totalSeats?: number;
  candidateCount: number;
  startTime?: string;
  endTime?: string;
  primaryEndTime?: string;
  // Turn-based deadlines — preferred over the timestamps for phase/countdown
  // diagnostics (freeze on pause, no wall-clock drift). Absent on legacy rows.
  startTurn?: number;
  endTurn?: number;
  primaryEndTurn?: number;
  durationHours?: number;
  primaryDurationHours?: number;
}

/**
 * Primary-vs-general phase, turn-first to match the engine
 * (`computeElectionPhase`). Falls back to wall-clock timestamps only when the
 * turn field or `currentTurn` is unavailable (legacy rows / missing game
 * state) — admin diagnostics otherwise drift when the cron lags behind
 * wall-clock. Returns false (general) when no primary bound exists, mirroring
 * the prior counting logic.
 */
export function isElectionInPrimaryPhase(
  e: Pick<ElectionData, "primaryEndTurn" | "primaryEndTime">,
  currentTurn: number | null
): boolean {
  if (typeof e.primaryEndTurn === "number" && currentTurn != null) {
    return currentTurn < e.primaryEndTurn;
  }
  if (e.primaryEndTime) {
    return new Date() < new Date(e.primaryEndTime);
  }
  return false;
}

const LANDTAG_CYCLE_PERIOD_HOURS = 240; // 5 game-years (period only — not preset-dependent)
const CN_NPC_DELEGATE_CYCLE_PERIOD_HOURS = 240; // 5 game-years (shared by npcDelegate + peoplesCongress)
const IE_DAIL_CYCLE_PERIOD_HOURS = 192; // 4 game-years
const IE_UACHTARAN_CYCLE_PERIOD_HOURS = 336; // 7 game-years
const IE_LOCAL_COUNCIL_CYCLE_PERIOD_HOURS = 240; // 5 game-years (EP-aligned)
const RU_SUPREME_SOVIET_CYCLE_PERIOD_HOURS = 192; // 4 game-years (shared by both chambers + republic soviets)

/** Canonical LARP end-turn for an election based on its type, class, and cycle.
 * Mirrors the server-side `canonicalTurnsForCycle` (see `canonicalCycle.ts`).
 *
 * `ctx` selects the preset's cycle anchors (1991 vs 2019). Defaults to the
 * 2019-default preset for callers that haven't been wired to fetch
 * GameState (e.g. legacy pages that don't have access to a server-loaded
 * preset). Pass an explicit ctx when previewing 1991-game timers.
 *
 * Snap shift: when `priorEndTurn` is provided for commons/regionalCouncil/
 * shugiin (the most recent resolved regular-or-snap for the same region),
 * the anchor is `priorEndTurn + cyclePeriodHours`. */
export function canonicalEndTurn(
  e: ElectionData,
  priorEndTurn?: number | null,
  ctx: CycleAnchorContext = DEFAULT_CYCLE_ANCHOR_CONTEXT
): number | null {
  if (!e.cycle) return null;
  const cycle = e.cycle;
  const anchors = getCycleAnchors(ctx);

  switch (e.electionType) {
    case "house":
      return anchors.house + (cycle - 1) * 96;
    case "senate": {
      const klass = e.senateClass ?? 2;
      const anchor =
        klass === 1
          ? anchors.senateClass1
          : klass === 2
            ? anchors.senateClass2
            : anchors.senateClass3;
      return anchor + (cycle - 1) * 288;
    }
    case "governor":
    case "stateSenate": {
      // D10: RU First Secretaries ride the republic-soviet anchor (null =
      // era-gated OFF). Mirrors the canonicalCycle.ts governor override.
      if (e.countryId === "RU") {
        if (anchors.ruRepublicSoviet == null) return null;
        return anchors.ruRepublicSoviet + (cycle - 1) * 192;
      }
      return anchors.governorStateSenate + (cycle - 1) * 192;
    }
    case "president":
      return anchors.president + (cycle - 1) * 192;
    case "commons":
    case "regionalCouncil":
      if (priorEndTurn != null) return priorEndTurn + UK_COMMONS_CYCLE_PERIOD_HOURS;
      if (cycle === 1) return anchors.ukCommons;
      return anchors.ukCommons + (cycle - 1) * UK_COMMONS_CYCLE_PERIOD_HOURS;
    case "shugiin":
      if (priorEndTurn != null) return priorEndTurn + 192;
      return anchors.jpShugiin + (cycle - 1) * 192;
    case "sangiin": {
      const klass = e.chamberClass ?? e.senateClass ?? 1;
      const sangiinAnchor = klass === 2 ? anchors.jpSangiinClass2 : anchors.jpSangiinClass1;
      return sangiinAnchor + (cycle - 1) * 144;
    }
    case "bundestag":
      if (priorEndTurn != null) return priorEndTurn + 192;
      return anchors.deBundestag + (cycle - 1) * 192;
    case "npcDelegate":
    case "peoplesCongress":
      // CN NPC + Provincial People's Congress: 5-year cycle (240 turns),
      // preset-anchored to the next NPC convening year (14th NPC 2023
      // for 2019-default; 8th NPC 1993 for 1991-default). Mirrors the
      // canonical-cycle dispatch in canonicalCycle.ts.
      return anchors.cnNpcDelegate + (cycle - 1) * CN_NPC_DELEGATE_CYCLE_PERIOD_HOURS;
    case "supremeSovietDeputy":
    case "nationalitiesDeputy":
      // RU: both national chambers share the ruSupremeSoviet anchor, 4-year
      // cycle (192 turns; mirrors BETA_PARLIAMENT_CYCLES). Null = era-gated OFF.
      if (anchors.ruSupremeSoviet == null) return null;
      return anchors.ruSupremeSoviet + (cycle - 1) * RU_SUPREME_SOVIET_CYCLE_PERIOD_HOURS;
    case "republicSupremeSoviet":
      if (anchors.ruRepublicSoviet == null) return null;
      return anchors.ruRepublicSoviet + (cycle - 1) * RU_SUPREME_SOVIET_CYCLE_PERIOD_HOURS;
    case "volkskammerDeputy":
      // DD: single-list Volkskammer, 4-year cycle (192 turns; shares the RU
      // cadence via BETA_PARLIAMENT_CYCLES ddVolkskammer). Null = era-gated OFF.
      if (anchors.ddVolkskammer == null) return null;
      return anchors.ddVolkskammer + (cycle - 1) * RU_SUPREME_SOVIET_CYCLE_PERIOD_HOURS;
    case "landtag": {
      // Per-Land anchor; cycle period 240 turns (5 game-years)
      // Pass "2019-default" as the admin UI always shows canonical 2019 anchors
      const anchor: number =
        (e.state ? getLandtagAnchor(e.state, "2019-default") : undefined) ?? 288;
      if (priorEndTurn != null) return priorEndTurn + LANDTAG_CYCLE_PERIOD_HOURS;
      if (cycle === 1) return anchor;
      return anchor + (cycle - 1) * LANDTAG_CYCLE_PERIOD_HOURS;
    }
    case "snap_shugiin":
    case "snap_commons":
    case "snap_bundestag":
      return null; // snap elections have fixed short durations
    case "dail":
      return anchors.ieDail + (cycle - 1) * IE_DAIL_CYCLE_PERIOD_HOURS;
    case "uachtaran":
      return anchors.ieUachtaran + (cycle - 1) * IE_UACHTARAN_CYCLE_PERIOD_HOURS;
    case "localCouncil":
      return anchors.ieLocalCouncil + (cycle - 1) * IE_LOCAL_COUNCIL_CYCLE_PERIOD_HOURS;
    default:
      return null;
  }
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

export interface ElectionsManageState {
  elections: ElectionData[];
  currentTurn: number | null;
  lastTurnProcessed: string | null;
  startingYear: number | null;
  preset: string | null;
  loading: boolean;
  message: string;
  messageDetails: string[];
  selectedCountry: CountrySelection;
  filterType: ElectionTypeFilter;
  filterCountry: CountryFilter;
  filterState: string;
  page: number;
  nextResolvingExpanded: boolean;
  timerForm: {
    action: "set" | "add" | "subtract";
    electionType: ElectionTypeFilter;
    state: string;
    senateClass: "" | "1" | "2" | "3";
    chamberClass: "" | "1" | "2";
    primaryHours: number | "";
    generalHours: number | "";
  };
}

export const initialElectionsManageState: ElectionsManageState = {
  elections: [],
  currentTurn: null,
  lastTurnProcessed: null,
  startingYear: null,
  preset: null,
  loading: false,
  message: "",
  messageDetails: [],
  selectedCountry: "US",
  filterType: "",
  filterCountry: "",
  filterState: "",
  page: 1,
  nextResolvingExpanded: false,
  timerForm: {
    action: "set",
    electionType: "",
    state: "",
    senateClass: "",
    chamberClass: "",
    primaryHours: "",
    generalHours: "",
  },
};

export type ElectionsManageAction =
  | { type: "LOAD_START" }
  | {
      type: "LOAD_SUCCESS";
      elections: ElectionData[];
      currentTurn: number | null;
      lastTurnProcessed: string | null;
      startingYear: number | null;
      preset: string | null;
    }
  | { type: "LOAD_END" }
  | { type: "SET_MESSAGE"; payload: string; details?: string[] }
  | { type: "SET_SELECTED_COUNTRY"; value: CountrySelection }
  | { type: "SET_FILTER_TYPE"; value: ElectionTypeFilter }
  | { type: "SET_FILTER_COUNTRY"; value: CountryFilter }
  | { type: "SET_FILTER_STATE"; value: string }
  | { type: "SET_PAGE"; value: number }
  | { type: "TOGGLE_NEXT_RESOLVING" }
  | { type: "SET_TIMER_ACTION"; value: "set" | "add" | "subtract" }
  | { type: "SET_TIMER_ELECTION_TYPE"; value: ElectionTypeFilter }
  | { type: "SET_TIMER_STATE"; value: string }
  | { type: "SET_TIMER_SENATE_CLASS"; value: "" | "1" | "2" | "3" }
  | { type: "SET_TIMER_CHAMBER_CLASS"; value: "" | "1" | "2" }
  | { type: "SET_TIMER_PRIMARY_HOURS"; value: number | "" }
  | { type: "SET_TIMER_GENERAL_HOURS"; value: number | "" };

export function electionsManageReducer(
  state: ElectionsManageState,
  action: ElectionsManageAction
): ElectionsManageState {
  switch (action.type) {
    case "LOAD_START":
      return { ...state, loading: true };
    case "LOAD_SUCCESS":
      return {
        ...state,
        loading: false,
        elections: action.elections,
        currentTurn: action.currentTurn,
        lastTurnProcessed: action.lastTurnProcessed,
        startingYear: action.startingYear,
        preset: action.preset,
      };
    case "LOAD_END":
      return { ...state, loading: false };
    case "SET_MESSAGE":
      return { ...state, message: action.payload, messageDetails: action.details ?? [] };
    case "SET_SELECTED_COUNTRY":
      return { ...state, selectedCountry: action.value, page: 1 };
    case "SET_FILTER_TYPE":
      return { ...state, filterType: action.value, page: 1 };
    case "SET_FILTER_COUNTRY":
      return { ...state, filterCountry: action.value, page: 1 };
    case "SET_FILTER_STATE":
      return { ...state, filterState: action.value, page: 1 };
    case "SET_PAGE":
      return { ...state, page: action.value };
    case "TOGGLE_NEXT_RESOLVING":
      return { ...state, nextResolvingExpanded: !state.nextResolvingExpanded };
    case "SET_TIMER_ACTION":
      return { ...state, timerForm: { ...state.timerForm, action: action.value } };
    case "SET_TIMER_ELECTION_TYPE": {
      const newForm = { ...state.timerForm, electionType: action.value };
      // Clear class filters when type changes to something that doesn't use them
      if (action.value !== "senate") newForm.senateClass = "";
      if (action.value !== "sangiin") newForm.chamberClass = "";
      return { ...state, timerForm: newForm };
    }
    case "SET_TIMER_STATE":
      return { ...state, timerForm: { ...state.timerForm, state: action.value } };
    case "SET_TIMER_SENATE_CLASS":
      return { ...state, timerForm: { ...state.timerForm, senateClass: action.value } };
    case "SET_TIMER_CHAMBER_CLASS":
      return { ...state, timerForm: { ...state.timerForm, chamberClass: action.value } };
    case "SET_TIMER_PRIMARY_HOURS":
      return { ...state, timerForm: { ...state.timerForm, primaryHours: action.value } };
    case "SET_TIMER_GENERAL_HOURS":
      return { ...state, timerForm: { ...state.timerForm, generalHours: action.value } };
    default:
      return state;
  }
}

"use client";

import { useCallback, useEffect, useReducer, useRef, type Dispatch } from "react";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictAssignment } from "@/lib/military/assignments";
import type { General } from "@/lib/military/generals";
import type { NatMods } from "@/lib/military/doctrineTree";
import { useDebouncedSave } from "@/hooks/useDebouncedSave";

/** A pending offensive the viewer's country has declared (awaiting the next tick). */
export interface PendingDeclarationView {
  theaterId: string;
  targetCountry: string;
  declaredTurn: number;
}

/** A resolved battle, rendered from the viewer's perspective. */
export interface BattleReportView {
  id: string;
  theaterId: string;
  theaterName: string;
  turn: number;
  noContact: boolean;
  role: "offensive" | "defensive";
  win: boolean;
  ownLoss: number;
  enemyLoss: number;
  enemyCountry: string;
  verdict: string;
  /** Set when a side broke off early; "own" when it was this viewer's force. */
  retreat: "own" | "enemy" | null;
  /**
   * Ground the engagement moved, as a percentage of the host country, from THIS
   * viewer's perspective: positive is ground gained, negative ground lost.
   *
   * Null on a report written before the front position was recorded — that is
   * "unknown", not "nothing moved", so the row says nothing rather than claiming a
   * stalemate. A win with 0 is a real result: the line held where it was.
   */
  groundPct: number | null;
}

/** A live conflict the viewer can see, with its territorial state. */
export interface ConflictView {
  id: string;
  name: string;
  hostCountry: string;
  /** Share of the host held by side B: 0 = side A holds all of it, 100 = side B. */
  control: number;
  sideALabel: string;
  sideBLabel: string;
  /**
   * The opposing side's belligerents, relative to the viewing nation — who it may
   * declare on at this front. Public roster only: unit counts and composition stay
   * server-side (see forecastFog).
   *
   * Optional because the same view backs the read-only FrontMap on the conflict record
   * page, which has no target picker and no viewer to be relative to. Absent and empty
   * mean the same thing to the war room — no targets offered — so it fails closed.
   */
  enemyCountries?: string[];
  /** The side standing on foreign soil, or null when the host is on neither side. */
  occupier: "A" | "B" | null;
  /** Cold War spectrum of the viewer's belligerent side. */
  ownSpectrum?: "west" | "east" | "neutral";
  /** A country on the occupying side, used to orient the advance. Null if generated. */
  occupierCountry: string | null;
  /** The host's own drawable region codes. `useRegionGeometry` resolves the
   *  shards holding them, so the page does not ship URLs. */
  hostRegionCodes: string[];
}

/** Seed supplied by the server component: live units, persisted org (general
 *  assignments + roles), resolved general stats, the viewer's pending declarations +
 *  recent reports, and route context. */
export interface CombatSeed {
  units: MilitaryUnit[];
  country: string;
  countryCode: string;
  positionId: string;
  currentTurn: number;
  natMods: NatMods;
  conflictAssignments: ConflictAssignment[];
  generalsById: Record<string, General>;
  positions: Record<string, string>;
  pendingDeclarations: PendingDeclarationView[];
  reports: BattleReportView[];
  conflicts: ConflictView[];
}

export interface CombatState {
  screen: string;
  selectedUnitId: string | null;
  units: MilitaryUnit[];
  conflictAssignments: ConflictAssignment[];
  generalsById: Record<string, General>;
  positions: Record<string, string>;
  pendingDeclarations: PendingDeclarationView[];
  reports: BattleReportView[];
  conflicts: ConflictView[];
  turn: number;
  country: string;
  /** Cabinet-scoped API base parts, so surfaces can call the gated battle routes. */
  countryCode: string;
  positionId: string;
  /** Server's reason for refusing the last mutation; null while nothing is refused. */
  refusal: string | null;
}

export type CombatAction =
  | { type: "SCREEN"; screen: string }
  | { type: "SELECT_UNIT"; id: string }
  | { type: "SET_POSTURE"; id: string; posture: string }
  | { type: "SET_ROLE"; id: string; role: string }
  | { type: "DECLARE"; theaterId: string; targetCountry: string }
  | { type: "WITHDRAW_DECLARATION"; theaterId: string }
  /**
   * Undo an optimistic mutation the server refused. `patch` carries the exact
   * pre-action slice, captured before the optimistic dispatch — the war room
   * would otherwise keep showing an offensive or posture that was never filed.
   */
  | { type: "ROLLBACK"; patch: Partial<CombatState>; message: string };

function seedState(seed: CombatSeed): CombatState {
  return {
    screen: "oob",
    selectedUnitId: seed.units[0] ? String(seed.units[0]._id) : null,
    units: seed.units,
    conflictAssignments: seed.conflictAssignments,
    generalsById: seed.generalsById,
    positions: seed.positions,
    pendingDeclarations: seed.pendingDeclarations,
    reports: seed.reports,
    conflicts: seed.conflicts,
    turn: seed.currentTurn,
    country: seed.country,
    countryCode: seed.countryCode,
    positionId: seed.positionId,
    refusal: null,
  };
}

export function combatReducer(state: CombatState, action: CombatAction): CombatState {
  switch (action.type) {
    case "SCREEN":
      return { ...state, screen: action.screen };
    case "SELECT_UNIT":
      return { ...state, selectedUnitId: action.id, screen: "dossier" };
    case "SET_POSTURE":
      return {
        ...state,
        units: state.units.map((u) =>
          String(u._id) === action.id
            ? { ...u, posture: action.posture as MilitaryUnit["posture"] }
            : u
        ),
      };
    case "SET_ROLE":
      return { ...state, positions: { ...state.positions, [action.id]: action.role } };
    case "DECLARE":
      // Optimistic: reflect the pending offensive immediately (server persists it).
      return {
        ...state,
        pendingDeclarations: [
          ...state.pendingDeclarations.filter((d) => d.theaterId !== action.theaterId),
          {
            theaterId: action.theaterId,
            targetCountry: action.targetCountry,
            declaredTurn: state.turn,
          },
        ],
      };
    case "WITHDRAW_DECLARATION":
      return {
        ...state,
        pendingDeclarations: state.pendingDeclarations.filter(
          (d) => d.theaterId !== action.theaterId
        ),
      };
    case "ROLLBACK":
      return { ...state, ...action.patch, refusal: action.message };
    default:
      return state;
  }
}

/**
 * Client state for the Combat Command page. Units + org (assignments/roles) come from
 * live gameState (seeded by the server component). Mutations persist to the live
 * cabinet/battle routes: posture immediately, role changes debounced, and offensives
 * via the declare route (resolved server-side on the next turn tick). Unit deployment
 * is not set here — a unit follows its assigned general (set in the cabinet office).
 * Read-only when the viewer holds no defense seat.
 */
export function useCombatState(seed: CombatSeed): {
  state: CombatState;
  dispatch: Dispatch<CombatAction>;
  natMods: NatMods;
} {
  const [state, rawDispatch] = useReducer(combatReducer, seed, seedState);
  const base = `/api/country/${seed.countryCode}/executive/cabinet/${seed.positionId}`;
  const canWrite = !!seed.positionId;

  // The optimistic slice is read through a ref so the async rollback restores the
  // state as it was when the action fired, not whatever the closure captured.
  // Synced in an effect, not during render: dispatch only ever runs from an event
  // handler, so by then the ref already holds the last committed state — which is
  // exactly the pre-action snapshot a rollback needs.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dispatch = useCallback<Dispatch<CombatAction>>(
    (action) => {
      if (canWrite) {
        /**
         * Fire the write, and undo the optimistic dispatch if the server refuses.
         * The battle routes reject for reasons the war room cannot see (no units at
         * the front, an offensive already filed, the seat lost, the subsystem
         * disabled), so a swallowed response would leave the board asserting an
         * order that was never filed.
         */
        const persist = (
          url: string,
          init: RequestInit,
          patch: Partial<CombatState>,
          fallback: string
        ) => {
          void (async () => {
            try {
              const res = await fetch(url, init);
              if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: string } | null;
                rawDispatch({ type: "ROLLBACK", patch, message: body?.error ?? fallback });
              }
            } catch {
              rawDispatch({ type: "ROLLBACK", patch, message: fallback });
            }
          })();
        };

        if (action.type === "SET_POSTURE") {
          persist(
            `${base}/military/${action.id}/posture`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ posture: action.posture }),
            },
            { units: stateRef.current.units },
            "The posture change was refused."
          );
        } else if (action.type === "DECLARE") {
          persist(
            `${base}/battle/declare`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                theaterId: action.theaterId,
                targetCountry: action.targetCountry,
              }),
            },
            { pendingDeclarations: stateRef.current.pendingDeclarations },
            "The offensive was refused."
          );
        } else if (action.type === "WITHDRAW_DECLARATION") {
          persist(
            `${base}/battle/declare?theaterId=${encodeURIComponent(action.theaterId)}`,
            { method: "DELETE" },
            { pendingDeclarations: stateRef.current.pendingDeclarations },
            "The withdrawal was refused."
          );
        }
      }
      rawDispatch(action);
    },
    [base, canWrite]
  );

  // Debounced persistence of the role layer after the initial seed. General
  // assignments are written by the Commanding General, not from this page.
  const roleSaveError = useDebouncedSave(
    `${base}/formations`,
    { positions: state.positions },
    canWrite,
    "Role changes could not be saved."
  );

  return {
    state: { ...state, refusal: state.refusal ?? roleSaveError },
    dispatch,
    natMods: seed.natMods,
  };
}

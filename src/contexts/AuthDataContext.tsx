"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import type { ReactNode } from "react";

// Shape matches the `user` object from GET /api/auth/me — kept loose so consumers
// can access any field without maintaining a parallel type definition.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthMeUser = Record<string, any>;

export type AuthFetchError = "none" | "rate_limited" | "unavailable" | "network";

export interface ClientNavBootstrap {
  user: AuthMeUser | null;
  hasCharacter: boolean;
  characterCountryId: string | null;
  characterName: string | null;
  unreadCount: number;
  unreadMailCount: number;
  myCorporationId: number | null;
  myCorporationType: string | null;
  myCorporationCountryId: string | null;
  /** Union the viewer leads, or else the one they organize in. Null if neither. */
  myUnionId: string | null;
  homeState: { id: string; name: string; countryId: string } | null;
  currentParty: { id: string; name: string; countryId: string } | null;
  activeElection: { id: string; seatId?: string; label: string } | null;
  cabinetOffice: { positionId: string; positionName: string; countryCode: string } | null;
  governorOffice: { stateId: string; stateName: string; countryCode: string } | null;
  activePresidentElectionId: string | null;
  activePresidentElectionSeatId: string | null;
  missingDemographics: boolean;
  adminCharacters: unknown[] | null;
  imperialCharacter: Record<string, unknown> | null;
  isImperialMode: boolean;
  wikiDisabled: boolean;
  /** When true, the Conflicts subsystem is live — drives the conditional
   *  "Conflicts" link in the World dropdown. */
  conflictsEnabled: boolean;
  /** When true, the labour system is at its "full" tier (player-run unions are
   *  live) — drives the conditional "Unions" link in the World dropdown. */
  unionsEnabled?: boolean;
  funds?: number | null;
  actions?: number | null;
  /**
   * Phase 6 — count of charters where any of the caller's characters
   * is a founder AND status is actionable (`pending-signatures` /
   * `founder-replacement`). Drives the conditional "My Party Charters"
   * entry in the Nation dropdown.
   */
  pendingCharterCount: number;
  /**
   * Newest unviewed Season Recap ("Wrapped") id for this user (any retirement
   * reason) — drives the post-reset/retirement recap gate. null when none
   * pending or the feature is off.
   */
  pendingSeasonRecapId?: string | null;
}

type AuthMeResult =
  | { kind: "ok"; payload: ClientNavBootstrap }
  | { kind: "transient"; reason: "rate_limit" | "server" | "network" };

interface AuthDataContextValue {
  /** The `user` object from /api/auth/me, or null when unauthenticated / loading. */
  user: AuthMeUser | null;
  /** True until the initial fetch resolves. */
  loading: boolean;
  /**
   * Set when /api/auth/me fails with 429, 5xx, or a network error.
   * Unlike a real sign-out (401), the previous `user` value is preserved when present
   * so UI does not flash to logged-out on transient failures.
   */
  authFetchError: AuthFetchError;
  /** Re-fetch auth state. Pass true after a manual "Retry" to show a brief loading state. */
  refetch: (isManualRetry?: boolean) => void;
  /** Shared /api/client-nav payload for global chrome consumers. */
  navData: ClientNavBootstrap | null;
}

const AuthDataContext = createContext<AuthDataContextValue | null>(null);

// Module-level dedup: when multiple components mount simultaneously and trigger
// a refetch, only one network request actually fires.
let inflightPromise: Promise<AuthMeResult> | null = null;

function fetchAuthMeOnce(): Promise<AuthMeResult> {
  if (inflightPromise) return inflightPromise;

  inflightPromise = fetch("/api/client-nav", {
    credentials: "same-origin",
    cache: "no-store",
  })
    .then(async (res): Promise<AuthMeResult> => {
      if (res.status === 429) {
        return { kind: "transient", reason: "rate_limit" };
      }
      if (res.status >= 500) {
        return { kind: "transient", reason: "server" };
      }
      if (!res.ok) {
        // Other client errors (403, 404 on misconfigured routes, etc.) — not a session drop.
        return { kind: "transient", reason: "server" };
      }
      const data = (await res.json()) as ClientNavBootstrap;
      return { kind: "ok", payload: data };
    })
    .catch((): AuthMeResult => ({ kind: "transient", reason: "network" }))
    .finally(() => {
      inflightPromise = null;
    });

  return inflightPromise;
}

function transientToErrorFlag(reason: "rate_limit" | "server" | "network"): AuthFetchError {
  if (reason === "rate_limit") return "rate_limited";
  if (reason === "network") return "network";
  return "unavailable";
}

export function AuthDataProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthMeUser | null>(null);
  const [navData, setNavData] = useState<ClientNavBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [authFetchError, setAuthFetchError] = useState<AuthFetchError>("none");
  const mountedRef = useRef(true);

  const load = useCallback((isManualRetry = false) => {
    if (isManualRetry) {
      setAuthFetchError("none");
      setLoading(true);
    }

    fetchAuthMeOnce().then((result) => {
      if (!mountedRef.current) return;

      if (result.kind === "transient") {
        setAuthFetchError(transientToErrorFlag(result.reason));
      } else {
        setNavData(result.payload);
        setUser(result.payload.user ?? null);
        setAuthFetchError("none");
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const t = window.setTimeout(() => {
      load(false);
    }, 0);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(t);
    };
  }, [load]);

  const refetch = useCallback((isManualRetry?: boolean) => load(!!isManualRetry), [load]);

  // Memoized so consumers only re-render when auth state actually changes,
  // not whenever the provider re-renders.
  const value = useMemo(
    () => ({ user, loading, authFetchError, refetch, navData }),
    [user, loading, authFetchError, refetch, navData]
  );

  return <AuthDataContext.Provider value={value}>{children}</AuthDataContext.Provider>;
}

/**
 * Access the shared auth + client-nav bootstrap response.
 *
 * Replaces individual auth/bootstrap fetches so global chrome shares a single
 * request instead of independently calling /api/auth/me and /api/client-nav.
 */
export function useAuthMe(): AuthDataContextValue {
  const ctx = useContext(AuthDataContext);
  if (!ctx) throw new Error("useAuthMe must be used within AuthDataProvider");
  return ctx;
}

/**
 * Non-throwing accessor for the Conflicts-subsystem flag. Returns false when
 * rendered outside an AuthDataProvider (e.g. isolated component tests), so
 * conflicts-gated UI stays hidden rather than crashing.
 */
export function useConflictsEnabled(): boolean {
  return useContext(AuthDataContext)?.navData?.conflictsEnabled ?? false;
}

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AuthDataProvider, useAuthMe } from "@/contexts/AuthDataContext";

const STORAGE_KEY = "ahd-interface-mode";
const COOKIE_KEY = "ahd-interface-mode";

export type InterfaceMode = "modern" | "classic";

interface InterfaceContextValue {
  mode: InterfaceMode;
  setMode: (mode: InterfaceMode) => void;
}

const InterfaceContext = createContext<InterfaceContextValue | null>(null);

/** Root composition keeps InterfaceProvider inside the auth context without
 * adding another level of indentation to the already-large app layout. */
export function AppInterfaceProvider({
  children,
  initialMode = "modern",
}: {
  children: ReactNode;
  initialMode?: InterfaceMode;
}) {
  return (
    <AuthDataProvider>
      <InterfaceProvider initialMode={initialMode}>{children}</InterfaceProvider>
    </AuthDataProvider>
  );
}

function storedMode(): InterfaceMode | null {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "modern" || value === "classic" ? value : null;
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
    return null;
  }
}

function persistMode(mode: InterfaceMode) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // The account preference still persists through the settings API.
  }
  try {
    document.cookie = `${COOKIE_KEY}=${mode}; Max-Age=31536000; Path=/; SameSite=Lax`;
  } catch {
    // Some embedded browser contexts also restrict cookie writes.
  }
}

function applyMode(mode: InterfaceMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.interface = mode;
}

/**
 * Keeps the interface choice available to every client-rendered surface.
 *
 * The persisted account preference remains the source of truth. A presentation
 * cookie seeds server rendering, and local storage provides a same-device
 * fallback while the shared auth bootstrap loads.
 */
export function InterfaceProvider({
  children,
  initialMode = "modern",
}: {
  children: ReactNode;
  initialMode?: InterfaceMode;
}) {
  const { user, loading, authFetchError } = useAuthMe();
  const [mode, setModeState] = useState<InterfaceMode>(initialMode);

  const setMode = useCallback((next: InterfaceMode) => {
    setModeState(next);
    applyMode(next);
    persistMode(next);
  }, []);

  // These effects reconcile React state with two external preference stores:
  // localStorage for the fast device fallback and the authenticated account
  // snapshot for the persisted source of truth.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const localMode = storedMode();
    if (localMode) {
      setMode(localMode);
    } else {
      applyMode(initialMode);
    }
  }, [initialMode, setMode]);

  useEffect(() => {
    if (loading || authFetchError !== "none") return;

    if (user) {
      setMode(user.enableExperimentalUI === false ? "classic" : "modern");
      return;
    }

    // Signed-out pages do not have an account preference. Keep the public
    // surface on the current design rather than leaking a previous session's
    // private preference through the login or registration experience.
    setMode("modern");
  }, [authFetchError, loading, setMode, user]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return <InterfaceContext.Provider value={value}>{children}</InterfaceContext.Provider>;
}

export function useInterface(): InterfaceContextValue {
  const context = useContext(InterfaceContext);
  if (!context) {
    return {
      mode: "modern",
      setMode: () => {},
    };
  }
  return context;
}

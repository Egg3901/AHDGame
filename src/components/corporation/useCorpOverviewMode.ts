"use client";

// Owns the corporation Overview's Simple / Pro preference. The account value
// from /api/auth/me wins once auth resolves; localStorage covers the moment
// before that and signed-out viewers. The Overview toggle and the Settings
// toggle share one storage key, and a same-tab storage event keeps both in
// step without a reload.

import { useCallback, useEffect, useState } from "react";
import { useOptionalAuthMe } from "@/contexts/AuthDataContext";
import { fetchJson } from "@/lib/observability/fetchJson";

export type CorpOverviewMode = "simple" | "pro";

export const CORP_OVERVIEW_MODE_KEY = "ahd-corp-overview-mode";
const DEFAULT_MODE: CorpOverviewMode = "pro";

function isMode(value: unknown): value is CorpOverviewMode {
  return value === "simple" || value === "pro";
}

function readStored(): CorpOverviewMode | null {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(CORP_OVERVIEW_MODE_KEY);
    return isMode(value) ? value : null;
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
    return null;
  }
}

function writeStored(mode: CorpOverviewMode) {
  try {
    localStorage.setItem(CORP_OVERVIEW_MODE_KEY, mode);
  } catch {
    // The account preference still persists through the settings API.
  }
  window.dispatchEvent(
    new StorageEvent("storage", { key: CORP_OVERVIEW_MODE_KEY, newValue: mode })
  );
}

export function useCorpOverviewMode(): {
  mode: CorpOverviewMode;
  setMode: (mode: CorpOverviewMode) => void;
} {
  const auth = useOptionalAuthMe();
  const authUser = auth?.user ?? null;
  const authLoading = auth?.loading ?? false;
  const [mode, setModeState] = useState<CorpOverviewMode>(DEFAULT_MODE);
  const [synced, setSynced] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- reading external preference stores */
  useEffect(() => {
    if (synced || authLoading) return;
    const serverMode = authUser?.corpOverviewMode;
    if (isMode(serverMode)) {
      setModeState(serverMode);
      try {
        localStorage.setItem(CORP_OVERVIEW_MODE_KEY, serverMode);
      } catch {
        // Nothing to restore from storage; the account value already applied.
      }
    } else {
      const stored = readStored();
      if (stored) setModeState(stored);
    }
    setSynced(true);
  }, [authLoading, authUser, synced]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === CORP_OVERVIEW_MODE_KEY && isMode(e.newValue)) setModeState(e.newValue);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const signedIn = !!authUser;
  const setMode = useCallback(
    (next: CorpOverviewMode) => {
      setModeState(next);
      writeStored(next);
      if (!signedIn) return;
      fetchJson("/api/settings/corp-overview-mode", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corpOverviewMode: next }),
        feature: "settings-corp-overview-mode",
      }).catch(() => undefined);
    },
    [signedIn]
  );

  return { mode, setMode };
}

"use client";

// Owns the StatusBar's layout-preference state. Seeds from the server
// preference (via /api/auth/me) once auth resolves, then falls back to
// localStorage. Listens for cross-tab storage changes so the settings
// toggle takes effect immediately.

import { useEffect, useState } from "react";
import { useAuthMe } from "@/contexts/AuthDataContext";

export type StatusBarLayout = "standard" | "corp" | "elections" | "full" | "minimal";

const LAYOUT_KEY = "statusBarLayout";
const VALID: readonly StatusBarLayout[] = [
  "standard",
  "corp",
  "elections",
  "full",
  "minimal",
] as const;

function isStatusBarLayout(value: unknown): value is StatusBarLayout {
  return typeof value === "string" && (VALID as readonly string[]).includes(value);
}

export function useStatusBarLayout(): { layout: StatusBarLayout; layoutSynced: boolean } {
  const { user: authUser, loading: authLoading } = useAuthMe();
  const [layout, setLayout] = useState<StatusBarLayout>("standard");
  const [layoutSynced, setLayoutSynced] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- reading external state */
  useEffect(() => {
    if (layoutSynced || authLoading) return;
    const serverLayout = authUser?.statusBarLayout;
    if (isStatusBarLayout(serverLayout)) {
      setLayout(serverLayout);
      if (typeof window !== "undefined") localStorage.setItem(LAYOUT_KEY, serverLayout);
    } else if (typeof window !== "undefined") {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (isStatusBarLayout(saved)) setLayout(saved);
    }
    setLayoutSynced(true);
  }, [authLoading, authUser, layoutSynced]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== LAYOUT_KEY) return;
      if (isStatusBarLayout(e.newValue)) setLayout(e.newValue);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  return { layout, layoutSynced };
}

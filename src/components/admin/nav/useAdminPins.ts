"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { MainTabId } from "@/components/admin/tabs/AdminTabsConfig";

export interface AdminPin {
  tab: MainTabId;
  /** Empty string = the main tab itself. */
  sub: string;
  label: string;
}

const STORAGE_KEY = "ahd-admin-pinned";
const MAX_PINS = 8;

export function pinKey(tab: string, sub: string): string {
  return sub ? `${tab}/${sub}` : tab;
}

function parsePins(raw: string | null): AdminPin[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is AdminPin =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as AdminPin).tab === "string" &&
        typeof (p as AdminPin).sub === "string" &&
        typeof (p as AdminPin).label === "string"
    );
  } catch {
    return [];
  }
}

// localStorage-backed external store: SSR snapshot is always empty, the raw
// string is cached so getSnapshot returns a stable reference between writes.
const EMPTY: AdminPin[] = [];
let cachedRaw: string | null = null;
let cachedPins: AdminPin[] = EMPTY;
const listeners = new Set<() => void>();

function getSnapshot(): AdminPin[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPins = parsePins(raw);
  }
  return cachedPins;
}

function getServerSnapshot(): AdminPin[] {
  return EMPTY;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Cross-tab sync comes for free via the storage event.
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function writePins(next: AdminPin[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota/privacy-mode failures just lose persistence, not the session state.
    cachedRaw = JSON.stringify(next);
    cachedPins = next;
  }
  for (const cb of listeners) cb();
}

/** Pinned admin destinations, persisted per browser in localStorage. */
export function useAdminPins() {
  const pins = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const isPinned = useCallback(
    (tab: string, sub: string) => pins.some((p) => pinKey(p.tab, p.sub) === pinKey(tab, sub)),
    [pins]
  );

  const togglePin = useCallback(
    (pin: AdminPin) => {
      const key = pinKey(pin.tab, pin.sub);
      const without = pins.filter((p) => pinKey(p.tab, p.sub) !== key);
      writePins(without.length === pins.length ? [...pins, pin].slice(-MAX_PINS) : without);
    },
    [pins]
  );

  return { pins, isPinned, togglePin };
}

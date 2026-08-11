"use client";

import { useSyncExternalStore } from "react";
import { isChromeSuppressedClient, type DisplayMode } from "@/lib/displayMode";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function getSnapshot(serverDisplayMode?: DisplayMode | null) {
  return isChromeSuppressedClient(serverDisplayMode ?? undefined);
}

function getServerSnapshot(serverDisplayMode?: DisplayMode | null) {
  return isFocusedDisplayModeServer(serverDisplayMode);
}

function isFocusedDisplayModeServer(displayMode?: DisplayMode | null): boolean {
  return displayMode === "focused";
}

/** Whether navbar/footer chrome is hidden (focused app mode). */
export function useChromeSuppressed(serverDisplayMode?: DisplayMode | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot(serverDisplayMode),
    () => getServerSnapshot(serverDisplayMode)
  );
}

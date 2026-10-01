"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { CONSENT_EVENT, CONSENT_RESET_EVENT, getStoredConsent } from "@/components/CookieConsent";
import { usePostHogVariant } from "@/lib/analytics/usePostHogVariant";
import { captureProductEvent } from "@/lib/analytics/capture";
import { PROFILE_DESIGN_KEY, PROFILE_DESIGN_PENDING_ATTR } from "@/lib/analytics/storageKeys";
import "./dossier.css";

/**
 * PostHog experiment `profile-redesign`: `control` is the current profile,
 * `test` is the dossier layout. Assignment is consent-gated like every other
 * experiment, so players without analytics consent always see control.
 *
 * The scope owns the assignment and tags its root with `data-profile-design`,
 * which drives the dossier palette in dossier.css. Slots swap the few
 * components the dossier rebuilds outright; everything else is restyled.
 */
export type ProfileDesign = "control" | "dossier";

const ProfileDesignContext = createContext<ProfileDesign>("control");

function readCachedDesign(): ProfileDesign | null {
  try {
    if (getStoredConsent() !== "accepted") return null;
    return window.localStorage.getItem(PROFILE_DESIGN_KEY) === "dossier" ? "dossier" : null;
  } catch {
    return null;
  }
}

function writeCachedDesign(design: ProfileDesign) {
  try {
    if (design === "dossier") window.localStorage.setItem(PROFILE_DESIGN_KEY, design);
    else window.localStorage.removeItem(PROFILE_DESIGN_KEY);
  } catch {
    // Storage is optional; the next visit just resolves without the cache.
  }
}

function subscribeConsent(onChange: () => void) {
  window.addEventListener(CONSENT_EVENT, onChange);
  window.addEventListener(CONSENT_RESET_EVENT, onChange);
  return () => {
    window.removeEventListener(CONSENT_EVENT, onChange);
    window.removeEventListener(CONSENT_RESET_EVENT, onChange);
  };
}

export function ProfileDesignScope({ children }: { children: ReactNode }) {
  const { variant, ready, assigned } = usePostHogVariant("profile-redesign");
  // Server and hydration render control; the cached assignment applies in the
  // synchronous post-hydration pass, before the preload script's hide lifts.
  const cached = useSyncExternalStore(subscribeConsent, readCachedDesign, () => null);
  const design: ProfileDesign = assigned
    ? variant === "test"
      ? "dossier"
      : "control"
    : (cached ?? "control");
  const viewCaptured = useRef(false);

  useLayoutEffect(() => {
    document.documentElement.removeAttribute(PROFILE_DESIGN_PENDING_ATTR);
  }, []);

  useEffect(() => {
    // Only a real answer from PostHog, or a consent withdrawal, rewrites the cache.
    if (assigned) writeCachedDesign(design);
    else if (ready && getStoredConsent() !== "accepted") writeCachedDesign("control");
  }, [ready, assigned, design]);

  useEffect(() => {
    if (!ready || viewCaptured.current) return;
    viewCaptured.current = true;
    void captureProductEvent("profile_design_viewed", {
      design,
      variant: assigned ? variant : "unassigned",
    });
  }, [ready, assigned, variant, design]);

  return (
    <ProfileDesignContext.Provider value={design}>
      <div
        className="min-h-screen bg-background pb-16"
        data-replay-block
        data-profile-design={design}
        data-profile-design-root
      >
        {children}
      </div>
    </ProfileDesignContext.Provider>
  );
}

/** Renders one of two server-rendered trees according to the active design. */
export function ProfileDesignSlot({
  control,
  dossier,
}: {
  control: ReactNode;
  dossier: ReactNode;
}) {
  return useContext(ProfileDesignContext) === "dossier" ? dossier : control;
}

/** Renders its children only in one design. */
export function ProfileDesignOnly({
  design,
  children,
}: {
  design: ProfileDesign;
  children: ReactNode;
}) {
  return useContext(ProfileDesignContext) === design ? children : null;
}

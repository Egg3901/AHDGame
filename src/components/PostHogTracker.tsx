"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { CONSENT_EVENT, CONSENT_RESET_EVENT, getStoredConsent } from "@/components/CookieConsent";
import { getPostHogClient } from "@/lib/analytics/posthogClient";
import {
  captureFirstTurnIfReady,
  capturePendingAccountCreated,
  capturePendingCharacterCreated,
  captureProductEvent,
  stopAnalyticsCapture,
} from "@/lib/analytics/capture";

function productArea(pathname: string): string | null {
  if (pathname === "/") return "landing";
  if (pathname === "/register") return "registration";
  if (pathname === "/create-character") return "character_creation";
  if (pathname === "/profile") return "profile";
  if (pathname.startsWith("/corporation")) return "corporations";
  if (pathname.startsWith("/bank")) return "banking";
  if (pathname.startsWith("/news")) return "media";
  if (pathname.startsWith("/elections")) return "elections";
  return null;
}

/** Captures only named areas and an opaque account id, never URLs or player text. */
export function PostHogTracker() {
  const pathname = usePathname();
  const { user } = useAuthMe();
  const userId = typeof user?.id === "string" ? user.id : null;
  const characterId = typeof user?.character?.id === "string" ? user.character.id : null;
  const [accepted, setAccepted] = useState(false);
  const previousUserId = useRef<string | null>(null);
  const lastCapturedPath = useRef<string | null>(null);
  const lastVisitUser = useRef<string | null>(null);

  useEffect(() => {
    const syncConsent = () => {
      const nextAccepted = getStoredConsent() === "accepted";
      setAccepted(nextAccepted);
      if (!nextAccepted) {
        previousUserId.current = null;
        lastCapturedPath.current = null;
        lastVisitUser.current = null;
        void stopAnalyticsCapture();
        return;
      }
      void getPostHogClient();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "ahd-cookie-consent" || event.key === null) syncConsent();
    };
    syncConsent();
    window.addEventListener(CONSENT_EVENT, syncConsent);
    window.addEventListener(CONSENT_RESET_EVENT, syncConsent);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CONSENT_EVENT, syncConsent);
      window.removeEventListener(CONSENT_RESET_EVENT, syncConsent);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const area = pathname ? productArea(pathname) : null;
    if (!accepted) return;
    let cancelled = false;
    void getPostHogClient().then((client) => {
      if (!client || cancelled || getStoredConsent() !== "accepted") return;
      if (userId && previousUserId.current !== userId) {
        client.identify(userId);
        previousUserId.current = userId;
      } else if (!userId && previousUserId.current) {
        client.reset();
        client.opt_in_capturing();
        previousUserId.current = null;
        lastVisitUser.current = null;
      }
      if (area && lastCapturedPath.current !== pathname) {
        void captureProductEvent("area_viewed", { area });
        lastCapturedPath.current = pathname;
      } else if (!area) {
        lastCapturedPath.current = null;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accepted, pathname, userId]);

  useEffect(() => {
    if (accepted && characterId) {
      void capturePendingCharacterCreated(characterId).then(() =>
        captureFirstTurnIfReady(characterId)
      );
    }
  }, [accepted, characterId, pathname]);

  useEffect(() => {
    if (accepted && userId) void capturePendingAccountCreated();
  }, [accepted, userId]);

  useEffect(() => {
    if (!accepted || !userId || lastVisitUser.current === userId) return;
    void getPostHogClient().then((client) => {
      if (!client || getStoredConsent() !== "accepted" || lastVisitUser.current === userId) return;
      if (previousUserId.current !== userId) {
        client.identify(userId);
        previousUserId.current = userId;
      }
      void captureProductEvent("game_visit");
      lastVisitUser.current = userId;
    });
  }, [accepted, userId]);

  return null;
}

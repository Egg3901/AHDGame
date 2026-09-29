"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { CONSENT_EVENT, CONSENT_RESET_EVENT, getStoredConsent } from "@/components/CookieConsent";
import {
  getPostHogClient,
  identifyPostHogUser,
  resetPostHogUser,
} from "@/lib/analytics/posthogClient";
import { useGameEvents } from "@/hooks/useGameEvents";
import {
  captureFirstTurnIfReady,
  capturePendingAccountCreated,
  capturePendingCharacterCreated,
  capturePendingWarDeclaration,
  captureProductEvent,
  stopAnalyticsCapture,
} from "@/lib/analytics/capture";
import { usePostHogVariant } from "@/lib/analytics/usePostHogVariant";

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
  const { user, navData } = useAuthMe();
  const userId = typeof user?.id === "string" ? user.id : null;
  const characterId = typeof user?.character?.id === "string" ? user.character.id : null;
  const [accepted, setAccepted] = useState(false);
  const previousUserId = useRef<string | null>(null);
  const previousPersonProperties = useRef<string | null>(null);
  const lastCapturedPath = useRef<string | null>(null);
  const lastVisitUser = useRef<string | null>(null);
  const sessionStartedAt = useRef<number | null>(null);
  const actionsTaken = useRef(0);
  const { variant: celebrationVariant } = usePostHogVariant("turn-complete-celebration");

  // The shared game clock emits this only after a committed turn becomes visible
  // to a signed-in player. It does not infer completions from elapsed time.
  useGameEvents(
    (event) => {
      const turn = event.payload.turn;
      if (typeof turn !== "number" || !userId) return;
      try {
        const marker = `${userId}:${turn}`;
        if (window.localStorage.getItem("ahd:last-tracked-turn") === marker) return;
        window.localStorage.setItem("ahd:last-tracked-turn", marker);
      } catch {
        // Analytics storage is optional.
      }
      void captureProductEvent("turn_completed", {
        turn_number: turn,
        nation_id: navData?.characterCountryId ?? "unknown",
        party_id: navData?.currentParty?.id ?? "none",
        role:
          navData?.cabinetOffice?.positionName ?? (navData?.governorOffice ? "governor" : "player"),
        actions_taken: actionsTaken.current,
        session_minutes: Math.round(
          (Date.now() - (sessionStartedAt.current ?? Date.now())) / 60000
        ),
        variant: celebrationVariant,
      });
      actionsTaken.current = 0;
      void capturePendingWarDeclaration(userId, true);
    },
    ["turn_complete"],
    accepted && !!userId
  );

  useEffect(() => {
    sessionStartedAt.current = Date.now();
    const onAction = () => {
      actionsTaken.current += 1;
    };
    window.addEventListener("ahd:game-action", onAction);
    return () => window.removeEventListener("ahd:game-action", onAction);
  }, []);

  useEffect(() => {
    const syncConsent = () => {
      const nextAccepted = getStoredConsent() === "accepted";
      setAccepted(nextAccepted);
      if (!nextAccepted) {
        previousUserId.current = null;
        previousPersonProperties.current = null;
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
      const personProperties = {
        ...(typeof user?.signupDate === "string" ? { signup_date: user.signupDate } : {}),
        ...(navData?.characterCountryId ? { nation: navData.characterCountryId } : {}),
        ...(navData?.currentParty?.id
          ? { party: navData.currentParty.id }
          : typeof user?.character?.party === "string"
            ? { party: user.character.party }
            : {}),
      };
      const propertiesKey = JSON.stringify(personProperties);
      if (
        userId &&
        (previousUserId.current !== userId || previousPersonProperties.current !== propertiesKey)
      ) {
        identifyPostHogUser(client, userId, personProperties);
        previousUserId.current = userId;
        previousPersonProperties.current = propertiesKey;
      } else if (!userId && previousUserId.current) {
        resetPostHogUser(client);
        previousUserId.current = null;
        previousPersonProperties.current = null;
        lastVisitUser.current = null;
      }
      if (userId && area && lastCapturedPath.current !== pathname) {
        void captureProductEvent("area_viewed", { area });
        lastCapturedPath.current = pathname;
      } else if (!area) {
        lastCapturedPath.current = null;
      }
      if (userId) void capturePendingAccountCreated();
      if (userId) void capturePendingWarDeclaration(userId);
      if (userId && characterId) {
        void capturePendingCharacterCreated(characterId).then(() =>
          captureFirstTurnIfReady(characterId)
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    accepted,
    pathname,
    userId,
    characterId,
    user?.signupDate,
    user?.character?.party,
    navData?.characterCountryId,
    navData?.currentParty?.id,
  ]);

  useEffect(() => {
    if (!accepted || !userId || lastVisitUser.current === userId) return;
    void getPostHogClient().then((client) => {
      if (!client || getStoredConsent() !== "accepted" || lastVisitUser.current === userId) return;
      if (previousUserId.current !== userId) {
        identifyPostHogUser(client, userId);
        previousUserId.current = userId;
      }
      void captureProductEvent("game_visit");
      lastVisitUser.current = userId;
    });
  }, [accepted, userId]);

  return null;
}

"use client";

import { useEffect, useMemo } from "react";
import { CONSENT_EVENT, CONSENT_RESET_EVENT, getStoredConsent } from "@/components/CookieConsent";
import { useAuthMe } from "@/contexts/AuthDataContext";
import {
  identifyOpenReplayUser,
  parseOpenReplaySampleRate,
  shouldRecordOpenReplay,
  startOpenReplay,
  stopOpenReplay,
} from "@/lib/observability/openReplay";

export function OpenReplayProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuthMe();
  const opaqueUserId = useMemo(
    () => (user?.id || user?._id ? String(user.id || user._id) : undefined),
    [user]
  );

  useEffect(() => {
    const sampleRate = parseOpenReplaySampleRate(process.env.NEXT_PUBLIC_OPENREPLAY_SAMPLE_RATE);
    const roll = Math.random();
    const reconcile = () => {
      if (shouldRecordOpenReplay(getStoredConsent(), sampleRate, roll)) {
        void startOpenReplay(opaqueUserId);
      } else {
        stopOpenReplay();
      }
    };
    reconcile();
    window.addEventListener(CONSENT_EVENT, reconcile);
    window.addEventListener(CONSENT_RESET_EVENT, reconcile);
    return () => {
      window.removeEventListener(CONSENT_EVENT, reconcile);
      window.removeEventListener(CONSENT_RESET_EVENT, reconcile);
    };
  }, [opaqueUserId]);

  useEffect(() => identifyOpenReplayUser(opaqueUserId), [opaqueUserId]);

  return <>{children}</>;
}

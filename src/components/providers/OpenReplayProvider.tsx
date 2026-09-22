"use client";

import { useEffect, useMemo, useRef } from "react";
import { CONSENT_EVENT, CONSENT_RESET_EVENT, getStoredConsent } from "@/components/CookieConsent";
import { useAuthMe } from "@/contexts/AuthDataContext";
import {
  buildOpenReplayMetadata,
  identifyOpenReplayUser,
  parseOpenReplaySampleRate,
  setOpenReplayMetadata,
  shouldRecordOpenReplay,
  startOpenReplay,
  stopOpenReplay,
} from "@/lib/observability/openReplay";

export function OpenReplayProvider({ children }: { children: React.ReactNode }) {
  const { user, navData } = useAuthMe();
  const opaqueUserId = useMemo(
    () => (user?.id || user?._id ? String(user.id || user._id) : undefined),
    [user]
  );
  const metadata = useMemo(
    () =>
      buildOpenReplayMetadata({
        authenticated: Boolean(user),
        hasCharacter: navData?.hasCharacter ?? false,
        characterCountryId: navData?.characterCountryId,
        corporationId: navData?.myCorporationId,
        corporationType: navData?.myCorporationType,
        corporationCountryId: navData?.myCorporationCountryId,
        partyCountryId: navData?.currentParty?.countryId,
        hasCabinetOffice: Boolean(navData?.cabinetOffice),
        hasGovernorOffice: Boolean(navData?.governorOffice),
        isImperialMode: navData?.isImperialMode ?? false,
      }),
    [navData, user]
  );
  const contextRef = useRef({ opaqueUserId, metadata });
  useEffect(() => {
    contextRef.current = { opaqueUserId, metadata };
  }, [metadata, opaqueUserId]);

  useEffect(() => {
    const sampleRate = parseOpenReplaySampleRate(process.env.NEXT_PUBLIC_OPENREPLAY_SAMPLE_RATE);
    const roll = Math.random();
    const reconcile = () => {
      if (shouldRecordOpenReplay(getStoredConsent(), sampleRate, roll)) {
        void startOpenReplay(contextRef.current.opaqueUserId, contextRef.current.metadata);
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
  }, []);

  useEffect(() => identifyOpenReplayUser(opaqueUserId), [opaqueUserId]);
  useEffect(() => setOpenReplayMetadata(metadata), [metadata]);

  return <>{children}</>;
}

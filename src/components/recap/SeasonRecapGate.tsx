"use client";

import { useEffect, useRef, useState } from "react";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { fetchJson } from "@/lib/observability/fetchJson";
import type { CharacterRecap } from "@/lib/recap/types";
import { SeasonRecapStory } from "./SeasonRecapStory";

/**
 * Global gate that surfaces the end-of-season Season Recap ("Wrapped") on the
 * player's next login after their character was archived (game reset or
 * retirement). Trigger = `pendingSeasonRecapId` on the shared /api/client-nav
 * bootstrap (only set for character-less sessions when the flag is on); the full
 * recap is loaded from the owner-scoped retired-character detail route. Marking
 * it seen (POST /api/recap/seen) is one-time and idempotent, so re-opening the
 * app never shows it twice. Older recaps remain re-viewable in character history.
 */
export function SeasonRecapGate() {
  const { navData, refetch } = useAuthMe();
  const pendingId = navData?.pendingSeasonRecapId ?? null;

  const [recap, setRecap] = useState<CharacterRecap | null>(null);
  const dismissedRef = useRef<string | null>(null); // guards re-show within a session

  useEffect(() => {
    if (!pendingId || dismissedRef.current === pendingId) return;
    let active = true;
    fetchJson<{ retiredCharacter?: { recap?: CharacterRecap } }>(
      `/api/settings/retired-characters/${pendingId}`,
      { credentials: "same-origin", cache: "no-store", feature: "season-recap-load" }
    )
      .then((d) => {
        if (active && d?.retiredCharacter?.recap) setRecap(d.retiredCharacter.recap);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pendingId]);

  if (!pendingId || !recap) return null;

  const close = () => {
    dismissedRef.current = pendingId;
    setRecap(null);
    // Mark viewed (best-effort, idempotent), then refresh nav so the id clears.
    void fetchJson("/api/recap/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recapId: pendingId }),
      credentials: "same-origin",
      feature: "season-recap-seen",
    })
      .catch(() => {})
      .finally(() => refetch(true));
  };

  return <SeasonRecapStory recap={recap} onClose={close} />;
}

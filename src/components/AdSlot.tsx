"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { isAdBannerPath } from "@/lib/adTrialPaths";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { fetchJson } from "@/lib/observability/fetchJson";

interface PlayerAdData {
  _id: string;
  imageUrl: string;
  linkUrl: string | null;
  altText: string | null;
  characterName: string;
}

// ── Player ad banner ──────────────────────────────────────────────────────────

interface PlayerAdBannerProps {
  onNoAd: () => void;
}

function PlayerAdBanner({ onNoAd }: PlayerAdBannerProps) {
  const [ad, setAd] = useState<PlayerAdData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const onNoAdRef = useRef(onNoAd);

  // Keep ref current so the async fetch callback never holds a stale closure.
  useEffect(() => {
    onNoAdRef.current = onNoAd;
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/player-ads/next")
      .then((r) => r.json())
      .then((data: { ad: PlayerAdData | null }) => {
        if (cancelled) return;
        if (data.ad) {
          setAd(data.ad);
          fetchJson(`/api/player-ads/${data.ad._id}/view`, {
            method: "POST",
            feature: "player-ad-view",
          }).catch(() => {});
        } else {
          onNoAdRef.current();
        }
      })
      .catch(() => {
        if (!cancelled) onNoAdRef.current();
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return <div style={{ minHeight: 66 }} />;
  if (!ad) return null;

  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary user-supplied ad URL, not whitelisted for Next/Image
    <img
      src={ad.imageUrl}
      alt={ad.altText ?? `Player advertisement by ${ad.characterName}`}
      className="w-full rounded object-contain"
      style={{ maxHeight: 80 }}
    />
  );

  return (
    <div className="w-full">
      <div className="relative">
        {ad.linkUrl ? (
          <a href={ad.linkUrl} target="_blank" rel="noopener noreferrer nofollow" className="block">
            {img}
          </a>
        ) : (
          img
        )}
        <p className="mt-0.5 text-right text-[10px] text-muted opacity-50">
          Player ad · {ad.characterName}
        </p>
      </div>
    </div>
  );
}

// ── AdSlot ────────────────────────────────────────────────────────────────────
// Placed once in the root layout, renders as a compact footer card.
// Shows player-run banner ads on listed paths. Ad-free Patreon subscribers
// see nothing.

export function AdSlot() {
  const pathname = usePathname();
  const { user, loading } = useAuthMe();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (loading) return;
    const pref: string = user?.patreonAdPreference ?? "all-ads";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(pref !== "ad-free");
  }, [pathname, loading, user?.patreonAdPreference]);

  if (!isAdBannerPath(pathname)) return null;
  if (loading || !show) return null;

  return (
    <div className="w-full border-t border-card-border bg-card px-4 py-2 sm:px-6 mb-14">
      <div className="mx-auto max-w-7xl">
        <PlayerAdBanner onNoAd={() => setShow(false)} />
      </div>
    </div>
  );
}

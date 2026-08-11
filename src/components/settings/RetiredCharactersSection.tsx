"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { fetchJson } from "@/lib/observability/fetchJson";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { SeasonRecapStory } from "@/components/recap/SeasonRecapStory";
import type { CharacterRecap } from "@/lib/recap/types";

interface RetiredCharacterData {
  _id: string;
  retiredAt: string;
  reason: "player_deleted" | "game_reset" | "admin_action";
  snapshot: {
    name: string;
    countryId: string;
    homeState: string;
    party: string;
    partyName: string;
    avatarUrl?: string;
    stats: {
      politicalInfluence: number;
      nationalInfluence?: number;
      favorability: number;
      infamy: number;
      funds: number;
    };
    highestOffice?: string;
    achievementCount: number;
    createdAt: string;
  };
  // Full recap payload — the list route returns whole documents, so the story
  // can be replayed straight from here without a per-character detail fetch.
  recap?: CharacterRecap;
  iteration?: { type: string; number: number };
}

const REASON_LABELS: Record<string, { label: string; color: string }> = {
  player_deleted: { label: "Retired", color: "bg-muted/20 text-muted border-muted/30" },
  game_reset: { label: "Game Reset", color: "bg-warning/15 text-warning border-warning/30" },
  admin_action: { label: "Admin Action", color: "bg-error/15 text-error border-error/30" },
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

export function RetiredCharactersSection() {
  const [retired, setRetired] = useState<RetiredCharacterData[]>([]);
  const [loading, setLoading] = useState(true);
  const [openRecap, setOpenRecap] = useState<CharacterRecap | null>(null);

  useEffect(() => {
    fetchJson<{ retiredCharacters?: RetiredCharacterData[] }>("/api/settings/retired-characters", {
      feature: "settings-retired-characters",
    })
      .then((data) => {
        if (data?.retiredCharacters) {
          setRetired(data.retiredCharacters);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-4">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-sm text-muted">Loading retired characters...</span>
      </div>
    );
  }

  if (retired.length === 0) {
    return (
      <p className="text-sm text-muted py-2">
        No retired characters. When you retire a character, their record will appear here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Your previously retired characters are preserved as historical records.
      </p>
      {retired.map((rc) => {
        const snap = rc.snapshot;
        const reasonInfo = REASON_LABELS[rc.reason] ?? REASON_LABELS.player_deleted;
        return (
          <div
            key={rc._id}
            className="relative rounded-xl border border-card-border bg-card-elevated/50 p-4 transition-colors hover:border-primary/40 hover:bg-card-elevated/70"
          >
            {/* Stretched link: keeps the whole card clickable without nesting a
                <button> inside an <a> (invalid markup). The content layer is
                pointer-events-none so clicks fall through to this, and the
                Wrapped button opts back in with pointer-events-auto. */}
            <Link
              href={`/retired/${rc._id}`}
              aria-label={`View ${snap.name}'s record`}
              className="absolute inset-0 z-0 rounded-xl"
            />
            <div className="pointer-events-none relative z-10 flex items-start gap-4">
              {/* Avatar */}
              <div className="h-12 w-12 shrink-0 rounded-lg bg-card-muted border border-card-border overflow-hidden">
                {snap.avatarUrl ? (
                  <Image
                    src={snap.avatarUrl}
                    alt={snap.name}
                    width={48}
                    height={48}
                    className="h-full w-full object-cover"
                    unoptimized={bypassNextImageOptimization(snap.avatarUrl)}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted text-lg font-semibold">
                    {snap.name.charAt(0)}
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-semibold text-foreground">{snap.name}</h4>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${reasonInfo.color}`}
                  >
                    {reasonInfo.label}
                  </span>
                  {rc.recap ? (
                    <button
                      type="button"
                      onClick={() => setOpenRecap(rc.recap ?? null)}
                      className="pointer-events-auto rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary transition-colors hover:border-primary/60 hover:bg-primary/20"
                    >
                      ✨ Wrapped
                    </button>
                  ) : null}
                </div>
                <p className="text-xs text-muted mt-0.5">
                  {snap.partyName} &middot; {snap.homeState}, {snap.countryId}
                </p>
                {snap.highestOffice && (
                  <p className="text-xs text-muted mt-0.5">Highest office: {snap.highestOffice}</p>
                )}
                <p className="text-xs text-muted mt-1">
                  {formatDate(snap.createdAt)} &mdash; {formatDate(rc.retiredAt)}
                </p>

                {/* Stats row */}
                <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted">
                  <span>
                    Influence:{" "}
                    <span className="font-medium text-foreground">
                      {snap.stats.politicalInfluence}
                    </span>
                  </span>
                  <span>
                    Favorability:{" "}
                    <span className="font-medium text-foreground">{snap.stats.favorability}%</span>
                  </span>
                  <span>
                    Achievements:{" "}
                    <span className="font-medium text-foreground">{snap.achievementCount}</span>
                  </span>
                </div>
              </div>

              {/* View arrow */}
              <div className="shrink-0 self-center text-muted">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </div>
          </div>
        );
      })}

      {/* Re-watch is purely local: it does NOT POST /api/recap/seen, so the
          story plays in full exactly as it did the first time and the viewed
          state on the server is left alone. Mirrors MaintenanceRecapLauncher. */}
      {openRecap && <SeasonRecapStory recap={openRecap} onClose={() => setOpenRecap(null)} />}
    </div>
  );
}

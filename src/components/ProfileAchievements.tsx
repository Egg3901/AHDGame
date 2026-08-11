"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getRarityStyle } from "@/lib/utils/achievementRarity";
import { fetchJson } from "@/lib/observability/fetchJson";
import { AchievementIcon } from "@/lib/utils/achievementIcons";
import { Lock } from "lucide-react";

interface AchievementItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  earnedAt: string | null;
  rarity: number;
  isHighlighted: boolean;
  earned: boolean;
  isHidden: boolean;
  order: number;
}

interface ProfileAchievementsProps {
  characterId: string;
  characterHref: string;
  isOwnProfile: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  special: "Special",
  action: "Actions",
  election: "Elections",
  legislation: "Legislation",
  social: "Social",
  milestone: "Milestones",
};

const CATEGORY_ORDER = ["special", "election", "legislation", "action", "social", "milestone"];

/** Chunky labeled tile — used in both showcase and expanded views */
function AchievementTile({ achievement }: { achievement: AchievementItem }) {
  const rarity = getRarityStyle(achievement.rarity);
  const locked = !achievement.earned;
  const hidden = locked && achievement.isHidden;

  return (
    <div className="group relative flex w-24 flex-col items-center gap-1.5">
      {/* Tooltip */}
      {!hidden && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2.5 hidden w-48 max-w-[calc(100vw-2rem)] -translate-x-1/2 group-hover:block">
          <div className="rounded-xl border border-card-border bg-card-elevated px-3 py-2.5 text-center shadow-[var(--shadow-lg)]">
            <p className="mb-0.5 text-xs font-semibold text-foreground/90">{achievement.name}</p>
            <p className="text-[10px] leading-relaxed text-muted/70">{achievement.description}</p>
            {!locked && (
              <p className="mt-1.5 text-[10px]" style={{ color: rarity.borderColor }}>
                {rarity.label}
                {achievement.rarity > 0 && (
                  <span className="text-muted/50"> · {achievement.rarity.toFixed(1)}%</span>
                )}
              </p>
            )}
            {achievement.earnedAt && (
              <p className="mt-0.5 text-[10px] text-muted/40">
                {new Date(achievement.earnedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}
          </div>
          <div className="flex justify-center">
            <div className="h-1 w-2 overflow-hidden">
              <div className="mx-auto h-2 w-2 -translate-y-1 rotate-45 border-b border-r border-card-border bg-card-elevated" />
            </div>
          </div>
        </div>
      )}

      {/* Badge icon */}
      <div
        className={`relative flex h-16 w-16 items-center justify-center rounded-2xl text-3xl transition-transform duration-150 group-hover:scale-105 ${locked ? "" : rarity.glowClass}`}
        style={
          locked
            ? {
                background: "var(--card-muted)",
                border: "1px solid var(--card-border)",
                filter: "grayscale(1)",
                opacity: 0.5,
              }
            : {
                background: `color-mix(in srgb, ${rarity.borderColor} 12%, var(--card-elevated))`,
                border: `1px solid color-mix(in srgb, ${rarity.borderColor} 40%, transparent)`,
              }
        }
      >
        {hidden ? (
          <Lock className="h-6 w-6 text-muted" />
        ) : (
          <AchievementIcon name={achievement.icon} className="h-8 w-8" />
        )}
        {/* Lock overlay for non-hidden locked achievements */}
        {locked && !hidden && <Lock className="absolute bottom-1 right-1 h-3 w-3 text-muted" />}
      </div>

      {/* Name */}
      <p
        className={`line-clamp-2 w-full text-center text-[10px] font-medium leading-tight ${
          locked ? "text-muted/40" : "text-foreground/80"
        }`}
      >
        {hidden ? "???" : achievement.name}
      </p>

      {/* Rarity label — only for earned */}
      {!locked && (
        <p className="text-[9px] font-semibold" style={{ color: rarity.borderColor }}>
          {rarity.label}
        </p>
      )}
    </div>
  );
}

export function ProfileAchievements({
  characterId,
  characterHref,
  isOwnProfile,
}: ProfileAchievementsProps) {
  const [highlighted, setHighlighted] = useState<AchievementItem[]>([]);
  const [allAchievements, setAllAchievements] = useState<AchievementItem[]>([]);
  const [totalEarned, setTotalEarned] = useState(0);
  const [totalAchievements, setTotalAchievements] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJson<{
      highlighted?: AchievementItem[];
      allAchievements?: AchievementItem[];
      totalEarned?: number;
      totalAchievements?: number;
    } | null>(`/api/characters/${characterId}/achievements`, {
      feature: "profile-achievements",
    })
      .then((data) => {
        if (data) {
          setHighlighted(
            (data.highlighted ?? []).map((h: AchievementItem) => ({
              ...h,
              earned: true,
              isHidden: false,
              order: 0,
            }))
          );
          setAllAchievements(data.allAchievements ?? []);
          setTotalEarned(data.totalEarned ?? 0);
          setTotalAchievements(data.totalAchievements ?? 0);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [characterId]);

  if (loading)
    return (
      <div className="flex flex-wrap gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 w-24 flex-none rounded-2xl bg-card-elevated animate-pulse" />
        ))}
      </div>
    );

  const earnedAchievements = allAchievements.filter((a) => a.earned);
  const lockedAchievements = allAchievements.filter((a) => !a.earned);

  // Showcase: highlighted first, then most recently earned, pad with locked up to 8
  const showcaseItems: AchievementItem[] = (() => {
    if (highlighted.length > 0) {
      const rest = earnedAchievements
        .filter((a) => !highlighted.some((h) => h.id === a.id))
        .slice(0, Math.max(0, 8 - highlighted.length));
      return [...highlighted, ...rest].slice(0, 8);
    }
    const earned = earnedAchievements.slice(0, 8);
    if (earned.length < 8) {
      return [...earned, ...lockedAchievements.slice(0, 8 - earned.length)];
    }
    return earned;
  })();

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat] ?? cat,
    items: allAchievements.filter((a) => a.category === cat).sort((a, b) => a.order - b.order),
    earnedCount: allAchievements.filter((a) => a.category === cat && a.earned).length,
    totalCount: allAchievements.filter((a) => a.category === cat).length,
  })).filter((g) => g.items.length > 0);

  const pct = totalAchievements > 0 ? (totalEarned / totalAchievements) * 100 : 0;

  return (
    <div className="rounded-2xl border border-card-border bg-card p-6">
      {/* Header */}
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="font-[var(--font-serif)] text-sm font-semibold tracking-wide text-foreground/80">
          Achievements
        </h2>
        {isOwnProfile && totalEarned > 0 && (
          <Link
            href="/settings#achievements"
            className="text-[10px] text-muted/50 transition-colors hover:text-primary"
          >
            edit highlights
          </Link>
        )}
      </div>

      {totalAchievements === 0 ? (
        <p className="text-sm italic text-muted">No achievements yet.</p>
      ) : !expanded ? (
        /* ── Showcase: labeled tile grid ── */
        <>
          {showcaseItems.length === 0 ? (
            <p className="text-sm italic text-muted">No achievements earned yet.</p>
          ) : (
            <div className="flex flex-wrap gap-4">
              {showcaseItems.map((a) => (
                <AchievementTile key={a.id} achievement={a} />
              ))}
            </div>
          )}
        </>
      ) : (
        /* ── Expanded: categorized tile grid ── */
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.category}>
              {/* Category header */}
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-widest text-foreground/60">
                  {group.label}
                </span>
                <div className="h-px flex-1 bg-card-border/40" />
                <span className="text-[10px] font-semibold text-muted/50">
                  {group.earnedCount}/{group.totalCount}
                </span>
              </div>
              {/* Per-category progress bar */}
              <div className="mb-3 h-1 overflow-hidden rounded-full bg-card-border/40">
                <div
                  className="h-full rounded-full bg-primary/50 transition-all duration-500"
                  style={{
                    width:
                      group.totalCount > 0
                        ? `${(group.earnedCount / group.totalCount) * 100}%`
                        : "0%",
                  }}
                />
              </div>
              {/* Tile grid */}
              <div className="flex flex-wrap gap-4">
                {group.items.map((a) => (
                  <AchievementTile key={a.id} achievement={a} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-5 border-t border-card-border/40 pt-4">
        {/* Progress */}
        <div className="mb-3 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-card-border/40">
            <div
              className="h-full rounded-full bg-primary/70 transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="shrink-0 tabular-nums text-xs font-semibold text-muted/60">
            {totalEarned}/{totalAchievements}
          </span>
        </div>

        <div className="flex gap-4">
          <Link
            href={`${characterHref}/achievements`}
            className="text-xs font-semibold text-primary transition-colors hover:text-primary/80"
          >
            View all achievements
          </Link>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            {expanded ? "Show less" : "Quick peek"}
          </button>
        </div>
      </div>
    </div>
  );
}

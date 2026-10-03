"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getRarityStyle } from "@/lib/utils/achievementRarity";
import { fetchJson } from "@/lib/observability/fetchJson";
import { AchievementIcon } from "@/lib/utils/achievementIcons";
import { Lock } from "lucide-react";
import { LocalTime } from "@/components/time/LocalTime";
import { SectionHeader } from "@/app/profile/components/ProfileMeters";
import { PROFILE_LINK_CLASS } from "@/app/profile/components/profileStyles";

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

/** Labeled badge tile, used in both the showcase and the expanded view. */
function AchievementTile({ achievement }: { achievement: AchievementItem }) {
  const rarity = getRarityStyle(achievement.rarity);
  const locked = !achievement.earned;
  const hidden = locked && achievement.isHidden;

  return (
    <div className="group relative flex w-20 flex-col items-center gap-1.5">
      {/* Tooltip */}
      {!hidden && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-48 max-w-[calc(100vw-2rem)] -translate-x-1/2 group-hover:block">
          <div className="rounded-md border border-card-border bg-card-elevated px-3 py-2.5 text-center shadow-lg">
            <p className="mb-0.5 text-body-sm font-semibold text-foreground">{achievement.name}</p>
            <p className="text-body-xs leading-relaxed text-muted">{achievement.description}</p>
            {!locked && (
              <p className="mt-1.5 text-body-xs text-muted">
                {rarity.label}
                {achievement.rarity > 0 && <span> · {achievement.rarity.toFixed(1)}%</span>}
              </p>
            )}
            {achievement.earnedAt && (
              <p className="mt-0.5 text-body-xs text-muted">
                <LocalTime
                  value={achievement.earnedAt}
                  options={{ month: "short", day: "numeric", year: "numeric" }}
                />
              </p>
            )}
          </div>
        </div>
      )}

      {/* Badge icon */}
      <div
        className={`relative flex h-14 w-14 items-center justify-center rounded-md border border-card-border ${
          locked ? "text-muted opacity-50" : "bg-card-elevated text-foreground"
        }`}
      >
        {hidden ? (
          <Lock className="h-5 w-5" />
        ) : (
          <AchievementIcon name={achievement.icon} className="h-7 w-7" />
        )}
        {/* Lock overlay for non-hidden locked achievements */}
        {locked && !hidden && <Lock className="absolute bottom-1 right-1 h-3 w-3" />}
      </div>

      {/* Name */}
      <p
        className={`line-clamp-2 w-full text-center text-body-xs font-medium leading-tight ${
          locked ? "text-muted/60" : "text-foreground"
        }`}
      >
        {hidden ? "???" : achievement.name}
      </p>

      {/* Rarity label, only for earned */}
      {!locked && <p className="text-body-xs text-muted">{rarity.label}</p>}
    </div>
  );
}

export function ProfileAchievements({
  characterId,
  characterHref,
  isOwnProfile,
}: ProfileAchievementsProps) {
  const t = useTranslations("profile.achievements");
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
    <section>
      <SectionHeader
        action={
          isOwnProfile && totalEarned > 0 ? (
            <Link href="/settings#achievements" className={`text-body-sm ${PROFILE_LINK_CLASS}`}>
              {t("editHighlights")}
            </Link>
          ) : undefined
        }
      >
        {t("title")}
      </SectionHeader>

      {loading ? (
        <div className="flex flex-wrap gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-20 w-20 flex-none animate-pulse rounded-md bg-card-elevated"
            />
          ))}
        </div>
      ) : (
        <>
          {totalAchievements === 0 ? (
            <p className="text-body text-muted">{t("none")}</p>
          ) : !expanded ? (
            /* Showcase: labeled tile grid */
            showcaseItems.length === 0 ? (
              <p className="text-body text-muted">{t("noneEarned")}</p>
            ) : (
              <div className="flex flex-wrap gap-4">
                {showcaseItems.map((a) => (
                  <AchievementTile key={a.id} achievement={a} />
                ))}
              </div>
            )
          ) : (
            /* Expanded: categorized tile grid */
            <div className="space-y-6">
              {grouped.map((group) => (
                <div key={group.category}>
                  <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-card-border/60 pb-1">
                    <span className="text-body-sm font-medium text-foreground">{group.label}</span>
                    <span className="text-body-xs tabular-nums text-muted">
                      {group.earnedCount}/{group.totalCount}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-4 pt-2">
                    {group.items.map((a) => (
                      <AchievementTile key={a.id} achievement={a} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex min-w-[12rem] flex-1 items-center gap-3">
              <div className="h-1 flex-1 bg-card-border/60" aria-hidden>
                <div className="h-full bg-foreground/60" style={{ width: `${pct}%` }} />
              </div>
              <span className="shrink-0 text-body-sm tabular-nums text-muted">
                {totalEarned}/{totalAchievements}
              </span>
            </div>
            <div className="flex gap-4">
              <Link
                href={`${characterHref}/achievements`}
                className={`text-body-sm ${PROFILE_LINK_CLASS}`}
              >
                {t("viewAll")}
              </Link>
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="text-body-sm font-medium text-muted transition-colors hover:text-foreground"
              >
                {expanded ? t("showLess") : t("quickPeek")}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { AchievementIcon } from "@/lib/utils/achievementIcons";
import { getRarityStyle, type RarityTier } from "@/lib/utils/achievementRarity";
import { fetchJson } from "@/lib/observability/fetchJson";
import { Avatar } from "@/components/Avatar";
import { Modal } from "@/components/ui";
import { LocalTime } from "@/components/time/LocalTime";

interface Progress {
  current: number;
  target: number;
}

interface AchievementItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  earnedAt: string | null;
  rarity: number;
  earned: boolean;
  isHidden: boolean;
  order: number;
  progress: Progress | null;
}

interface RecentHolder {
  name: string;
  earnedAt: string;
}

const CATEGORIES = ["special", "election", "legislation", "action", "social", "milestone"];
const LABELS: Record<string, string> = {
  special: "Special",
  election: "Elections",
  legislation: "Legislation",
  action: "Actions",
  social: "Social",
  milestone: "Milestones",
};

export function AchievementsShowcaseClient({
  characterId,
  characterName,
  avatarUrl,
}: {
  characterId: string;
  characterName: string;
  avatarUrl?: string | null;
}) {
  const [items, setItems] = useState<AchievementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AchievementItem | null>(null);
  const [holders, setHolders] = useState<RecentHolder[]>([]);
  const [holdersLoading, setHoldersLoading] = useState(false);

  useEffect(() => {
    fetchJson<{ allAchievements: AchievementItem[] }>(
      `/api/characters/${characterId}/achievements`,
      { feature: "achievement-showcase" }
    )
      .then((result) => setItems(result?.allAchievements ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [characterId]);

  const earned = items.filter((item) => item.earned);
  const completion = items.length ? Math.round((earned.length / items.length) * 100) : 0;
  const rarityCounts = useMemo(() => {
    const counts: Record<RarityTier, number> = {
      legendary: 0,
      epic: 0,
      rare: 0,
      uncommon: 0,
      common: 0,
    };
    earned.forEach((item) => counts[getRarityStyle(item.rarity).tier]++);
    return counts;
  }, [earned]);
  const nearlyThere = items
    .filter((item) => !item.earned && !item.isHidden && item.progress?.target)
    .sort(
      (a, b) =>
        (b.progress?.current ?? 0) / (b.progress?.target ?? 1) -
        (a.progress?.current ?? 0) / (a.progress?.target ?? 1)
    )
    .slice(0, 6);

  function openAchievement(item: AchievementItem) {
    if (!item.earned && item.isHidden) return;
    setSelected(item);
    setHolders([]);
    setHoldersLoading(true);
    fetchJson<{ holders: RecentHolder[] }>(`/api/achievements/${item.id}/recent-holders`, {
      feature: "achievement-recent-holders",
    })
      .then((result) => setHolders(result?.holders ?? []))
      .catch(() => setHolders([]))
      .finally(() => setHoldersLoading(false));
  }

  if (loading) {
    return <div className="mx-auto max-w-7xl px-4 py-12 text-muted">Loading achievements...</div>;
  }

  return (
    <main className="mx-auto max-w-7xl space-y-10 px-4 py-8 sm:px-6">
      <section className="overflow-hidden rounded-2xl border border-card-border bg-card shadow-panel">
        <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-8">
          <Avatar url={avatarUrl} name={characterName} size="h-24 w-24" />
          <div className="min-w-0 flex-1">
            <p className="text-body-sm font-semibold uppercase tracking-widest text-primary">
              Achievement showcase
            </p>
            <h1 className="mt-1 font-display text-display text-foreground">
              {characterName}&apos;s achievements
            </h1>
            <p className="mt-2 text-muted">
              {earned.length} of {items.length} earned, {completion}% complete
            </p>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {(Object.keys(rarityCounts) as RarityTier[]).map((tier) => (
              <div
                key={tier}
                className="rounded-lg border border-card-border bg-card-elevated p-2 text-center"
              >
                <div className="text-heading-sm font-bold text-foreground">
                  {rarityCounts[tier]}
                </div>
                <div className="text-body-xs capitalize text-muted">{tier}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="h-2 bg-track">
          <div className="h-full bg-primary" style={{ width: `${completion}%` }} />
        </div>
      </section>

      {nearlyThere.length > 0 && (
        <section>
          <h2 className="font-display text-heading-lg text-foreground">Nearly there</h2>
          <p className="mt-1 text-body text-muted">The closest achievements still in reach.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {nearlyThere.map((item) => {
              const progress = item.progress!;
              const percent = Math.min(100, (progress.current / progress.target) * 100);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openAchievement(item)}
                  className="rounded-lg border border-card-border bg-card p-4 text-left card-hover"
                >
                  <div className="flex items-center gap-3">
                    <AchievementIcon name={item.icon} className="h-8 w-8 text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-3">
                        <span className="font-semibold text-foreground">{item.name}</span>
                        <span className="text-body-sm tabular-nums text-muted">
                          {progress.current}/{progress.target}
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-track">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {CATEGORIES.map((category) => {
        const categoryItems = items
          .filter((item) => item.category === category)
          .sort((a, b) => a.order - b.order);
        if (!categoryItems.length) return null;
        return (
          <section key={category}>
            <h2 className="font-display text-heading-lg text-foreground">{LABELS[category]}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {categoryItems.map((item) => {
                const hidden = !item.earned && item.isHidden;
                const rarity = getRarityStyle(item.rarity);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openAchievement(item)}
                    disabled={hidden}
                    className={`relative rounded-xl border border-card-border bg-card p-5 text-left ${
                      hidden ? "cursor-default opacity-50" : "card-hover"
                    }`}
                  >
                    <div className={`flex gap-4 ${item.earned ? "" : "grayscale opacity-60"}`}>
                      <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-card-elevated">
                        {hidden ? (
                          <span className="font-bold text-muted">???</span>
                        ) : (
                          <AchievementIcon name={item.icon} className="h-9 w-9 text-foreground" />
                        )}
                        {!item.earned && !hidden && (
                          <Lock className="absolute bottom-1 right-1 h-4 w-4 text-muted" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">
                          {hidden ? "???" : item.name}
                        </h3>
                        <p className="mt-1 text-body-sm text-muted">
                          {hidden ? "Hidden achievement" : item.description}
                        </p>
                        <p
                          className="mt-3 text-body-xs font-semibold"
                          style={{ color: rarity.borderColor }}
                        >
                          {item.rarity.toFixed(1)}% of players, {rarity.label}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      <Modal
        open={selected !== null}
        title={selected?.name ?? "Achievement"}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div>
            <p className="text-body text-muted">{selected.description}</p>
            <h3 className="mt-5 font-semibold text-foreground">Recently unlocked by</h3>
            {holdersLoading ? (
              <p className="mt-2 text-body-sm text-muted">Loading...</p>
            ) : holders.length ? (
              <ul className="mt-2 divide-y divide-card-border">
                {holders.map((holder) => (
                  <li
                    key={`${holder.name}-${holder.earnedAt}`}
                    className="flex justify-between py-2 text-body-sm"
                  >
                    <span className="text-foreground">{holder.name}</span>
                    <span className="text-muted">
                      <LocalTime value={holder.earnedAt} options={{ dateStyle: "medium" }} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-body-sm text-muted">No recent holders found.</p>
            )}
          </div>
        )}
      </Modal>
    </main>
  );
}

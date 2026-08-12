"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@/components/ui";
import { fetchJson } from "@/lib/observability/fetchJson";
import { AchievementIcon } from "@/lib/utils/achievementIcons";

interface AchievementItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  rarity: number;
  isHighlighted: boolean;
}

interface SettingsAchievementsSectionProps {
  characterId?: string;
}

const MAX_HIGHLIGHTS = 5;

export function SettingsAchievementsSection({ characterId }: SettingsAchievementsSectionProps) {
  const t = useTranslations("settings");
  const [achievements, setAchievements] = useState<AchievementItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Use character-specific endpoint if character exists, otherwise account-level
    const url = characterId
      ? `/api/characters/${characterId}/achievements`
      : "/api/settings/achievements/list";

    fetchJson<{
      achievements?: AchievementItem[];
      highlighted?: { id: string }[];
    } | null>(url, { feature: "settings-achievements-list" })
      .then((data) => {
        if (data) {
          const items = data.achievements ?? [];
          setAchievements(items);
          const highlighted = (data.highlighted ?? []).map((a: { id: string }) => a.id);
          setSelected(new Set(highlighted));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [characterId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_HIGHLIGHTS) {
        next.add(id);
      }
      return next;
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/achievements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ highlightedAchievementIds: Array.from(selected) }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({ text: t("achievements.saved"), ok: true });
      } else {
        setMsg({ text: data.error ?? t("common.saveFailed"), ok: false });
      }
    } catch {
      setMsg({ text: t("common.networkError"), ok: false });
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  if (loading) return null;

  if (achievements.length === 0) {
    return (
      <section className="scroll-mt-24 rounded-2xl border border-card-border bg-card/80 backdrop-blur-sm p-6 md:p-8 shadow-card">
        <SectionLabel>{t("achievements.title")}</SectionLabel>
        <p className="text-sm text-muted">{t("achievements.empty")}</p>
      </section>
    );
  }

  return (
    <section className="scroll-mt-24 rounded-2xl border border-card-border bg-card/80 backdrop-blur-sm p-6 md:p-8 shadow-card">
      <div className="flex items-center gap-2 mb-1">
        <span className="block h-3 w-0.5 rounded-full bg-primary opacity-70 shrink-0" />
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
          {t("achievements.title")}
        </h2>
      </div>
      <p className="mb-4 text-sm text-muted">{t("achievements.intro")}</p>
      <form onSubmit={handleSave} className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {achievements.map((a) => (
            <label
              key={a.id}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
                characterId ? "cursor-pointer" : ""
              } ${
                selected.has(a.id)
                  ? "border-primary bg-primary/10"
                  : "border-card-border bg-background hover:border-card-border/80 hover:bg-card/50"
              }`}
            >
              {characterId && (
                <input
                  type="checkbox"
                  checked={selected.has(a.id)}
                  onChange={() => toggle(a.id)}
                  disabled={!selected.has(a.id) && selected.size >= MAX_HIGHLIGHTS}
                  className="h-4 w-4 rounded border-card-border text-primary focus:ring-primary"
                />
              )}
              <AchievementIcon name={a.icon} className="h-5 w-5 text-muted" />
              <span className="text-sm font-medium">{a.name}</span>
            </label>
          ))}
        </div>
        {characterId && (
          <p className="text-xs text-muted">
            {t("achievements.selectedCount", { count: selected.size, max: MAX_HIGHLIGHTS })}
          </p>
        )}
        {msg && (
          <div
            className={`flex items-center gap-2.5 rounded-xl p-4 text-sm ${msg.ok ? "bg-success/15 text-success border border-success/30" : "bg-error/15 text-error border border-error/30"}`}
          >
            {msg.ok ? (
              <svg
                className="h-5 w-5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            ) : (
              <svg
                className="h-5 w-5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            )}
            {msg.text}
          </div>
        )}
        {characterId && (
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("achievements.save")}
          </button>
        )}
      </form>
    </section>
  );
}

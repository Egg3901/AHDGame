"use client";

/**
 * Battleground map — emphasizes margin tiers + the 5-closest filter as
 * a unified shell for general-election margin display. Pure wrapper
 * around `USAMapPaths`; takes margin data from the `generalViewModel`
 * and computes per-state shading using the same 4-tier band the
 * existing PresidentialMapWithStateDetail uses for popular-vote shading.
 *
 * Per Phase 5b D5: independent of the presidential-specific map so it
 * can be reused on other surfaces. The existing PresidentialMapWithStateDetail
 * remains the primary EV map; BattlegroundMap is the margin-emphasis sibling.
 *
 * Click-through dispatches `onSelectState` so the parent can sync the
 * RegistrationInfluenceCard + PersuasionDrivers selection with map clicks.
 *
 * See plan §"Phase 5b — Tasks" 5b.4 + D5.
 */

import { useTranslations } from "next-intl";
import { USAMapPaths, type StateMapData } from "@/components/USAMapPaths";
import type {
  BattlegroundHoverCardData,
  MarginInfo,
  MarginTier,
} from "@/lib/elections/generalViewModel";

/** Translated tier label lookup. Built inline where `t` is available. */
function tierLabels(t: ReturnType<typeof useTranslations>): Record<MarginTier, string> {
  return {
    safe: t("battleground.tierSafe"),
    likely: t("battleground.tierLikely"),
    lean: t("battleground.tierLean"),
    tossup: t("battleground.tierTossup"),
  };
}

const TIER_BAND: Record<MarginTier, string> = {
  safe: "≥ 15pp",
  likely: "10–15pp",
  lean: "5–10pp",
  tossup: "< 5pp",
};

/**
 * Apply the 4-tier shading to a candidate's party color. Matches the
 * popular-vote shading already used by PresidentialMapWithStateDetail
 * so users see the same visual language across maps.
 */
export function shadeColorForTier(color: string, tier: MarginTier): string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  if ([r, g, b].some(Number.isNaN)) return color;
  if (tier === "safe") {
    return `rgb(${Math.floor(r * 0.7)}, ${Math.floor(g * 0.7)}, ${Math.floor(b * 0.7)})`;
  }
  if (tier === "likely") {
    return color;
  }
  if (tier === "lean") {
    return `rgb(${Math.floor(r + (255 - r) * 0.5)}, ${Math.floor(g + (255 - g) * 0.5)}, ${Math.floor(b + (255 - b) * 0.5)})`;
  }
  // tossup — nearly white with a tint
  return `rgb(${Math.floor(r + (255 - r) * 0.85)}, ${Math.floor(g + (255 - g) * 0.85)}, ${Math.floor(b + (255 - b) * 0.85)})`;
}

/**
 * Compact per-state hover card content rendered as the `tooltipNode` of
 * USAMapPaths when hover-card data is provided. Shows top-2 (or top-3
 * when 3rd ≥ 5%) candidate breakdown + margin tier line.
 *
 * Exported for unit testing — also rendered inline by `BattlegroundMap`.
 */
export function HoverCard({ data }: { data: BattlegroundHoverCardData }) {
  const t = useTranslations("elections");
  const TIER_LABEL = tierLabels(t);
  return (
    <div className="min-w-[200px]">
      <div className="text-xs font-semibold text-slate-100">{data.stateName}</div>
      <ul className="mt-1.5 space-y-0.5">
        {data.candidates.map((c) => (
          <li
            key={`${c.partyAbbr}-${c.name}`}
            className="flex items-center gap-2 text-[11px] text-slate-200"
          >
            <span
              className="inline-block h-2 w-2 rounded-full shrink-0"
              style={{ background: c.partyColor }}
            />
            <span className="font-semibold text-slate-100">{c.partyAbbr}</span>
            <span className="flex-1 truncate">{c.name}</span>
            <span className="tabular-nums">{c.votePct.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 border-t border-slate-700 pt-1 text-[10px] uppercase tracking-wider text-slate-400">
        {data.candidates[0]?.partyAbbr ?? "?"} +{data.marginPp.toFixed(1)}pp ·{" "}
        {TIER_LABEL[data.tier]}
      </div>
    </div>
  );
}

export function BattlegroundMap({
  marginByState,
  hoverCardByState,
  highlightedStates,
  onSelectState,
  /** Optional: only show legend tiers that exist in the data. Defaults true. */
  collapseEmptyTiers = true,
}: {
  marginByState: Record<string, MarginInfo>;
  /** Phase 7a Item 1 — per-state hover card content. When omitted, the map
   *  falls back to the existing string-array tooltip. */
  hoverCardByState?: Record<string, BattlegroundHoverCardData>;
  /** Optional: 5-closest or admin-picked highlights. Renders with a purple ring. */
  highlightedStates?: string[];
  onSelectState?: (stateId: string) => void;
  collapseEmptyTiers?: boolean;
}) {
  const t = useTranslations("elections");
  const TIER_LABEL = tierLabels(t);
  const stateData: Record<string, StateMapData> = {};
  const presentTiers = new Set<MarginTier>();
  for (const [stateId, info] of Object.entries(marginByState)) {
    const card = hoverCardByState?.[stateId];
    stateData[stateId] = {
      color: shadeColorForTier(info.leaderColor, info.tier),
      tooltip: [`${info.leaderId} +${info.margin.toFixed(1)}pp · ${TIER_LABEL[info.tier]}`],
      tooltipNode: card ? <HoverCard data={card} /> : undefined,
    };
    presentTiers.add(info.tier);
  }

  const tiersToShow: MarginTier[] = collapseEmptyTiers
    ? (["safe", "likely", "lean", "tossup"] as MarginTier[]).filter((t) => presentTiers.has(t))
    : (["safe", "likely", "lean", "tossup"] as MarginTier[]);

  const hasData = Object.keys(marginByState).length > 0;

  return (
    <div className="rounded-xl border border-card-border bg-card p-3 sm:p-6 overflow-hidden shadow-panel">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
          {t("battleground.title")}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-muted">
          {t("battleground.subtitle")}
        </span>
      </div>
      <div
        className="w-full max-w-full rounded-lg bg-background p-2 sm:p-4 min-h-[240px] sm:min-h-[300px] overflow-hidden"
        style={{ aspectRatio: "960/600", boxShadow: "inset 0 2px 8px 0 rgb(0 0 0 / 0.4)" }}
      >
        <USAMapPaths
          stateData={stateData}
          highlightedStates={highlightedStates}
          onStateClick={onSelectState}
        />
      </div>

      {!hasData ? (
        <p className="mt-3 text-xs text-muted">{t("battleground.emptyHint")}</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-[10px] uppercase tracking-wider text-muted">
            {t("battleground.marginTiers")}
          </span>
          {tiersToShow.map((tier) => (
            <span key={tier} className="flex items-center gap-1.5 text-muted">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: shadeColorForTier("#9CA3AF", tier) }}
              />
              <span>
                {TIER_LABEL[tier]}{" "}
                <span className="opacity-60 tabular-nums">{TIER_BAND[tier]}</span>
              </span>
            </span>
          ))}
          {highlightedStates && highlightedStates.length > 0 ? (
            <span className="flex items-center gap-1.5 text-purple-400">
              <span className="inline-block h-3 w-3 rounded-sm border-2 border-purple-400" />
              <span className="text-xs">
                {t("battleground.battlegroundCount", { count: highlightedStates.length })}
              </span>
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

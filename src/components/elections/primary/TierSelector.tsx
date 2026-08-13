"use client";

/**
 * Race-tier selector chip strip — Presidential / Senate / Governor / House.
 *
 * Renders as the chrome at the top of the per-party primary surfaces. Each
 * chip navigates to its tier's per-party page:
 *  - Presidential → `/president/primary/[partyId]`
 *  - Senate / Governor / House → `/elections/primary/[tier]/[partyId]`
 *
 * Strip renders only when `countryId === "US"` — non-US surfaces don't have
 * the same nationally-aggregated tier system.
 *
 * Pure presentational; routing is delegated to `onTierChange` so the
 * caller can either navigate (via Next router) or update local state.
 */
import { useTranslations } from "next-intl";

export type RaceTier = "president" | "senate" | "stateSenate" | "governor" | "house";

interface TierConfig {
  id: RaceTier;
  labelKey:
    | "tierSelector.president"
    | "tierSelector.senate"
    | "tierSelector.house"
    | "tierSelector.governor"
    | "tierSelector.stateSenate";
  icon: string;
}

const TIERS: TierConfig[] = [
  { id: "president", labelKey: "tierSelector.president", icon: "🇺🇸" },
  { id: "senate", labelKey: "tierSelector.senate", icon: "🏛" },
  { id: "house", labelKey: "tierSelector.house", icon: "📍" },
  { id: "governor", labelKey: "tierSelector.governor", icon: "🏰" },
  { id: "stateSenate", labelKey: "tierSelector.stateSenate", icon: "🏢" },
];

export function TierSelector({
  countryId,
  activeTier,
  partyColor,
  onTierChange,
}: {
  countryId: string;
  activeTier: RaceTier;
  partyColor?: string;
  /**
   * Fires when the user clicks a tier chip other than the active one.
   * Active-chip clicks are no-ops.
   */
  onTierChange?: (tier: RaceTier) => void;
}) {
  const t = useTranslations("elections");
  // Hide entirely outside the US.
  if (countryId.toUpperCase() !== "US") return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-1 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
        {t("tierSelector.raceTier")}
      </span>
      {TIERS.map((tier) => {
        const isActive = tier.id === activeTier;
        const isClickable = !isActive && !!onTierChange;
        const baseClasses = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
          isClickable ? "cursor-pointer hover:bg-[var(--card-muted)]" : "cursor-default"
        } ${!isActive && !isClickable ? "opacity-40" : ""}`;
        const accentStyle = isActive
          ? {
              borderColor: partyColor ?? "var(--primary)",
              color: partyColor ?? "var(--primary)",
              backgroundColor: partyColor
                ? `color-mix(in srgb, ${partyColor} 14%, transparent)`
                : "color-mix(in srgb, var(--primary) 14%, transparent)",
            }
          : { borderColor: "var(--card-border)" };
        const label = t(tier.labelKey);
        return (
          <button
            key={tier.id}
            type="button"
            onClick={() => !isActive && onTierChange?.(tier.id)}
            className={baseClasses}
            style={accentStyle}
            title={label}
          >
            <span aria-hidden="true">{tier.icon}</span>
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export const __ALL_TIERS_FOR_TEST: TierConfig[] = TIERS;

"use client";

/**
 * National Mood card — the economic-referendum reading for a presidential race.
 *
 * Read-only view of `ElectionVoteTally.economicReferendum`, which the
 * presidential engine writes on each accumulation turn. Nothing here is
 * recomputed: the shift is already inside the vote totals, and this card only
 * shows which way the economy is pushing the incumbent party, how hard, and
 * which components make up the total.
 *
 * Renders nothing when the field is absent (races that ran before the channel
 * existed).
 */

import { useTranslations } from "next-intl";
import { REFERENDUM_SHARE_CLAMP } from "@/lib/electionEngine/economicReferendum";

export interface NationalMoodData {
  miseryIndex: number;
  /** Signed share shift for the incumbent party, in points. */
  sharePts: number;
  components: Array<{ key: string; label: string; contributionPts: number }>;
  /** Penalty-side multiplier for consecutive terms held. 1 when it does not apply. */
  fatigueMultiplier: number;
  incumbentPartyId?: string;
  incumbentPartyName?: string;
  incumbentPartyColor?: string;
  recordedTurn: number;
}

const POSITIVE_FALLBACK = "#22c55e";
const NEGATIVE_COLOR = "#ef4444";

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function ComponentRow({
  label,
  contributionPts,
  positiveColor,
}: {
  label: string;
  contributionPts: number;
  positiveColor: string;
}) {
  const t = useTranslations("elections");
  const isPositive = contributionPts >= 0;
  return (
    <div className="flex items-baseline justify-between text-xs">
      <span className="font-semibold">{label}</span>
      <span
        className="tabular-nums font-bold"
        style={{ color: isPositive ? positiveColor : NEGATIVE_COLOR }}
      >
        {signed(contributionPts)} {t("nationalMood.pts")}
      </span>
    </div>
  );
}

export function NationalMoodGauge({ data }: { data?: NationalMoodData | null }) {
  const t = useTranslations("elections");
  if (!data) return null;

  const partyLabel = data.incumbentPartyName ?? t("nationalMood.incumbentFallback");
  const positiveColor = data.incumbentPartyColor ?? POSITIVE_FALLBACK;
  const isPositive = data.sharePts >= 0;
  const barColor = isPositive ? positiveColor : NEGATIVE_COLOR;
  const widthPct =
    (Math.min(Math.abs(data.sharePts), REFERENDUM_SHARE_CLAMP) / REFERENDUM_SHARE_CLAMP) * 50;

  const fatigueTerm =
    data.fatigueMultiplier >= 1.5 ? t("nationalMood.termFourthPlus") : t("nationalMood.termThird");

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
          {t("nationalMood.title")}
        </h3>
        <span className="tabular-nums text-sm font-bold" style={{ color: barColor }}>
          {signed(data.sharePts)} {t("nationalMood.pts")}
        </span>
      </div>
      <p className="mb-3 text-xs leading-snug text-muted">{t("nationalMood.subtitle")}</p>

      <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-muted">
        <span>{t("nationalMood.againstIncumbent", { party: partyLabel })}</span>
        <span>{t("nationalMood.towardIncumbent", { party: partyLabel })}</span>
      </div>
      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-background"
        role="img"
        aria-label={t("nationalMood.title")}
      >
        <span
          className="absolute top-0 h-full"
          style={{ left: "50%", width: 1, background: "var(--card-border)" }}
        />
        <span
          className="absolute top-0 h-full"
          style={{
            left: isPositive ? "50%" : `${50 - widthPct}%`,
            width: `${widthPct}%`,
            background: barColor,
            opacity: 0.85,
          }}
        />
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted">
        {t("nationalMood.scaleNote", { clamp: REFERENDUM_SHARE_CLAMP })}
      </p>

      {data.components.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted">
            {t("nationalMood.componentsGroup")}
          </div>
          {data.components.map((c) => (
            <ComponentRow
              key={c.key}
              label={c.label}
              contributionPts={c.contributionPts}
              positiveColor={positiveColor}
            />
          ))}
        </div>
      ) : null}

      {data.fatigueMultiplier > 1 ? (
        <p className="mt-2 rounded border border-card-border bg-background px-2 py-1.5 text-[11px] leading-snug text-muted">
          {t("nationalMood.fatigue", {
            term: fatigueTerm,
            multiplier: data.fatigueMultiplier.toFixed(2).replace(/0$/, ""),
          })}
        </p>
      ) : null}

      <p className="mt-2 text-[10px] uppercase tracking-wider text-muted">
        {t("nationalMood.recordedTurn", { turn: data.recordedTurn })}
      </p>
    </div>
  );
}

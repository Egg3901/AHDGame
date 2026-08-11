import type { NationalCorporationViewModel } from "@/lib/nationalization/nationalCorporationView";
import { currencySymbol } from "./natMoney";

function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

type Tone = "success" | "error" | "gold" | "muted" | "foreground";

const TONE: Record<Tone, string> = {
  success: "text-success",
  error: "text-error",
  gold: "text-gold",
  muted: "text-muted",
  foreground: "text-foreground",
};

interface HeroStatsStripProps {
  stats: NationalCorporationViewModel["stats"];
  currency: string;
}

/**
 * Public-instrument metrics under the masthead (spec §17) — deliberately NOT a
 * market strip: no share price / market cap. Foregrounds the corp's value as a
 * tool of the state. Mirrors the prototype's six-tile strip. Inherits ahd tokens.
 */
export function HeroStatsStrip({ stats, currency }: HeroStatsStripProps) {
  const sym = currencySymbol(currency);
  const effTone: Tone =
    stats.sectorCount === 0 ? "foreground" : stats.soeEfficiencyPenalty > -12 ? "success" : "error";
  const confTone: Tone =
    stats.investorConfidence < stats.confidenceBaseline
      ? "error"
      : stats.investorConfidence > stats.confidenceBaseline
        ? "success"
        : "foreground";

  const tiles: Array<{
    label: string;
    value: string;
    valueTone?: Tone;
    sub?: string;
    subTone?: Tone;
  }> = [
    {
      label: "Treasury remittance / turn",
      value: `${sym}${compact(stats.treasuryRemittancePerTurn)}`,
      valueTone: stats.treasuryRemittancePerTurn > 0 ? "success" : "foreground",
      sub: `subsidy −${sym}${compact(stats.mandateSubsidyPerTurn)}/turn`,
      subTone: stats.mandateSubsidyPerTurn > 0 ? "error" : "muted",
    },
    {
      label: "Public-value index",
      value: String(stats.publicValueIndex),
      valueTone: "gold",
      sub: "public mandates served",
    },
    {
      label: "Citizens served",
      value: compact(stats.citizensServed),
      sub: `${compact(stats.jobsGuaranteed)} jobs guaranteed`,
    },
    {
      label: "Sectors held",
      value: String(stats.sectorCount),
      sub: `${stats.regionsCovered} region${stats.regionsCovered === 1 ? "" : "s"}`,
    },
    {
      label: "SOE efficiency",
      value: `${stats.soeEfficiencyPenalty}%`,
      valueTone: effTone,
      sub: "dynamic · replaces flat −15%",
    },
    {
      label: "Investor confidence",
      value: `${Math.round(stats.investorConfidence)}/100`,
      valueTone: confTone,
      sub: `baseline ${stats.confidenceBaseline} · +${stats.confidenceTrendPerTurn}/turn`,
      subTone: stats.confidenceTrendPerTurn > 0 ? "success" : "muted",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden bg-card-border sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <div key={t.label} className="bg-card px-4 py-3">
          <div className="text-body-xs uppercase tracking-wide text-muted">{t.label}</div>
          <div
            className={`mt-1 text-heading-sm font-semibold tabular-nums ${TONE[t.valueTone ?? "foreground"]}`}
          >
            {t.value}
          </div>
          {t.sub && (
            <div className={`text-body-xs tabular-nums ${TONE[t.subTone ?? "muted"]}`}>{t.sub}</div>
          )}
        </div>
      ))}
    </div>
  );
}

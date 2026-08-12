import { useTranslations } from "next-intl";
import type {
  ChamberCompositionData,
  CompositionResponse,
  PartySeats,
} from "@/lib/elections/electionResponseTypes";
import {
  ParliamentChart,
  SeatBar,
  SeatLegend,
  MajorityBanner,
  type PartySeatsDisplay,
} from "@/components/ChamberChart";

function toDisplay(seats: PartySeats[]): PartySeatsDisplay[] {
  return seats.map((p) => ({ ...p }));
}

const CLASS_ROMAN = ["I", "II", "III"];

/**
 * Seat composition for one chamber, current or projected.
 *
 * Chamber name and seat total come from the response, which reads them from the
 * country's config. This previously hardcoded the US House and Senate names and
 * divided by 435/100, so every other country was mislabelled.
 */
export function ChamberComposition({
  composition,
  chamberKey,
  activeSenateClass,
}: {
  composition: CompositionResponse;
  /** Which chamber of the response to render. */
  chamberKey: string;
  /** Contested class for a classed upper chamber, else null. */
  activeSenateClass: number | null;
}) {
  const t = useTranslations("elections");
  const chamber: ChamberCompositionData | null =
    composition.lower?.key === chamberKey
      ? composition.lower
      : composition.upper?.key === chamberKey
        ? composition.upper
        : null;

  if (!chamber) return null;

  const current = toDisplay(chamber.current);
  const projected = toDisplay(chamber.projected);
  const total = chamber.totalSeats;
  const isUpper = composition.upper?.key === chamberKey;

  const chartSeats = chamber.inGeneral ? projected : current;
  const chartLabel = chamber.inGeneral
    ? t("chamberComposition.projectedLabel")
    : t("chamberComposition.currentLabel");

  return (
    <div className="space-y-4 rounded-xl border border-card-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{chamber.name}</h3>
          {isUpper && activeSenateClass != null && (
            <p className="mt-0.5 text-xs text-muted">
              {t("chamberComposition.classContested", {
                className: CLASS_ROMAN[activeSenateClass - 1] ?? activeSenateClass,
              })}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {chamber.inGeneral && (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary" />
          )}
          <span className="text-[10px] text-muted">{chartLabel}</span>
        </div>
      </div>

      <ParliamentChart seats={chartSeats} total={total} />
      <SeatBar seats={chartSeats} total={total} />

      {chamber.inGeneral && (
        <div className="space-y-1">
          <span className="text-[10px] text-muted">{t("chamberComposition.currentBefore")}</span>
          <SeatBar seats={current} total={total} />
        </div>
      )}

      <SeatLegend seats={chartSeats} total={total} />
      <MajorityBanner seats={chartSeats} total={total} chamberLabel={chamber.name} />

      {chamber.inGeneral && (
        <p className="text-[10px] italic text-muted/50">{t("chamberComposition.projectionNote")}</p>
      )}
    </div>
  );
}

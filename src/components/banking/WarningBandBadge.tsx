"use client";

import { Badge, type BadgeColor } from "@/components/ui";

export type WarningBand = "green" | "amber" | "red";

const BAND_COLOR: Record<WarningBand, BadgeColor> = {
  green: "success",
  amber: "warning",
  red: "error",
};

const BAND_LABEL: Record<WarningBand, string> = {
  green: "Stable",
  amber: "Watch",
  red: "At risk",
};

interface Props {
  band: WarningBand | null | undefined;
  /** Show numeric confidence next to the band label when provided. */
  confidence?: number | null;
  className?: string;
}

/** Published bank warning band chip (green / amber / red via semantic Badge colors). */
export function WarningBandBadge({ band, confidence, className }: Props) {
  if (!band) {
    return (
      <Badge color="default" variant="subtle" className={className}>
        Unknown
      </Badge>
    );
  }

  const confLabel =
    typeof confidence === "number" && Number.isFinite(confidence)
      ? ` ${(confidence * 100).toFixed(0)}%`
      : "";

  return (
    <Badge color={BAND_COLOR[band]} variant="subtle" dot className={className}>
      {BAND_LABEL[band]}
      {confLabel}
    </Badge>
  );
}

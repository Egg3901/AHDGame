"use client";

import { useMemo } from "react";
import {
  westminsterParliamentSvgString,
  type GovernmentContext,
} from "@/lib/charts/westminsterParliament";
import type { PartySeatsDisplay } from "@/components/ChamberChart";

const VACANT_FILL = "var(--card-border)";

export function WestminsterParliamentChart({
  seats,
  total,
  governmentContext,
}: {
  seats: PartySeatsDisplay[];
  total: number;
  governmentContext?: GovernmentContext;
}) {
  const svgHtml = useMemo(() => {
    const rows = seats
      .filter((p) => p.party !== "__vacant__")
      .map((p) => ({
        party: p.party,
        partyColor: p.partyColor,
        economicPosition: p.economicPosition,
        seats: p.seats,
      }));
    return westminsterParliamentSvgString(rows, total, VACANT_FILL, governmentContext);
  }, [seats, total, governmentContext]);

  if (!svgHtml || total === 0) return null;

  return (
    <div
      className="w-full [&_svg]:h-auto [&_svg]:max-h-[min(260px,40vh)] [&_svg]:w-full"
      // westminster-svg outputs static SVG; no user HTML in the string
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  );
}

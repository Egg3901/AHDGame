"use client";

/**
 * Who holds this market, at a glance.
 *
 * The ring answers one question: how much of this sector is yours. Everything
 * about its construction serves that and nothing else.
 *
 * It used to give every rival its own slice, cycling a nine-colour list with
 * `i % 9`. In a sector with seventeen NPP rivals at ~5% each that produced a
 * rainbow of near-identical wedges in which the viewer's own 5.7% was
 * indistinguishable, and the cycling meant two different companies could be
 * handed the same colour. The colours were also assigned by array POSITION, so a
 * rival leaving the sector repainted everyone after it.
 *
 * So the ring is now an emphasis chart. Player-owned corps keep saturated,
 * stable colours; the NPP field folds into a single muted arc behind them. That
 * is a deliberate trade: per-NPP detail leaves the chart and lives in the list
 * beside it, which is the right home for seventeen near-equal values.
 */

import { playerSlotColor, NPP_ARC_COLOR } from "../lib/marketColors";

interface MarketPieCompetitor {
  corporationId?: string;
  corporationName: string;
  brandColor?: string;
  marketShare: number;
  isNpp?: boolean;
}

interface MarketPieProps {
  myShare: number;
  myColor: string;
  competitors: MarketPieCompetitor[];
  unownedPercent: number;
  size?: number;
}

export default function MarketPie({
  myShare,
  myColor,
  competitors,
  unownedPercent,
  size = 120,
}: MarketPieProps) {
  const radius = Math.round(size * 0.4);
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = Math.round(size * 0.2);
  const circumference = 2 * Math.PI * radius;

  const playerRivals = competitors.filter((c) => !c.isNpp && c.marketShare > 0);
  const nppRivals = competitors.filter((c) => c.isNpp && c.marketShare > 0);
  const nppShare = nppRivals.reduce((sum, c) => sum + c.marketShare, 0);

  // Viewer first, then the other players, then the NPP field as one arc. Order is
  // the reading order of the list beside it, so a slice and its row line up.
  const segments: { percent: number; color: string; label: string; muted?: boolean }[] = [
    { percent: myShare, color: myColor, label: "You" },
  ];
  playerRivals.forEach((comp, i) => {
    segments.push({
      // Colour follows the ENTITY: a corp's own brand colour when it has one, and
      // otherwise a fixed slot keyed off its id, so the same company keeps the
      // same colour when a rival leaves the sector. Never the loop index.
      percent: comp.marketShare,
      color: comp.brandColor || playerSlotColor(comp.corporationId ?? comp.corporationName, i),
      label: comp.corporationName,
    });
  });
  if (nppShare > 0) {
    segments.push({
      percent: nppShare,
      color: NPP_ARC_COLOR,
      label:
        nppRivals.length === 1
          ? `${nppRivals[0].corporationName} (NPP)`
          : `NPP field (${nppRivals.length} corps)`,
      muted: true,
    });
  }
  if (unownedPercent > 0) {
    segments.push({
      percent: unownedPercent,
      color: "rgba(128,128,128,0.2)",
      label: "Unowned",
      muted: true,
    });
  }

  // A 2px gap of surface between fills, so neighbouring arcs read as separate
  // marks rather than one continuous band. Taken out of each arc's own length,
  // never added, or the ring would over-run 100%. Skipped when a segment is too
  // small to survive losing it.
  const GAP_PX = 2;
  const drawn = segments.map((seg) => {
    const full = (seg.percent / 100) * circumference;
    return { ...seg, full, dash: full > GAP_PX * 2 ? full - GAP_PX : full };
  });

  let offset = 0;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={
        nppShare > 0
          ? `Your share ${myShare.toFixed(1)} percent. The NPP field holds ${nppShare.toFixed(1)} percent across ${nppRivals.length} corporations.`
          : `Your share ${myShare.toFixed(1)} percent.`
      }
    >
      {drawn.map((seg, i) => {
        const dashOffset = -offset;
        offset += seg.full;
        return (
          <circle
            key={`${seg.label}-${i}`}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${seg.dash} ${circumference - seg.dash}`}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${cx} ${cy})`}
            opacity={seg.muted ? 0.55 : 1}
          >
            <title>{`${seg.label}: ${seg.percent.toFixed(1)}%`}</title>
          </circle>
        );
      })}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        className="fill-foreground text-sm font-bold"
        fontSize="14"
      >
        {myShare.toFixed(1)}%
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" className="fill-muted text-[9px]" fontSize="9">
        your share
      </text>
    </svg>
  );
}

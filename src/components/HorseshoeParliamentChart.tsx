"use client";

import { horseshoeLayout } from "@/lib/charts/seatingLayouts";
import { sortLR, type PartySeatsDisplay } from "@/components/ChamberChart";

const VACANT_FILL = "var(--card-border)";

/**
 * Party-colored Dáil Éireann horseshoe composition chart — the IE counterpart
 * to {@link ParliamentChart} (hemicycle) and WestminsterParliamentChart
 * (benches). Seats are coloured left→right by economic position so parties form
 * contiguous blocks down the left leg, across the arc, and down the right leg.
 */
export function HorseshoeParliamentChart({
  seats,
  total,
}: {
  seats: PartySeatsDisplay[];
  total: number;
}) {
  if (total === 0) return null;

  const { pts, seatR, vb, chairY } = horseshoeLayout(total);
  const ordered = sortLR(seats);
  const colors: string[] = [];
  for (const p of ordered) {
    for (let i = 0; i < p.seats; i++) colors.push(p.partyColor);
  }
  while (colors.length < pts.length) colors.push(VACANT_FILL);

  const [vx, vy, vw, vh] = vb;
  return (
    <svg viewBox={`${vx} ${vy} ${vw} ${vh}`} className="w-full" style={{ maxHeight: 250 }}>
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={seatR} fill={colors[i] ?? VACANT_FILL} />
      ))}
      {/* Ceann Comhairle's chair */}
      <circle cx={0} cy={chairY} r={seatR * 1.05} fill="var(--muted)" />
    </svg>
  );
}

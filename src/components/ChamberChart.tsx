"use client";

/**
 * Shared chamber composition chart components used on both the elections
 * and congress pages.
 */
import { PartyLogo } from "@/components/PartyLogo";
import type { CoalitionViewData } from "@/components/legislature/useCoalitionView";
import type { CountryId } from "@/lib/constants/countries";
import { computeRowRadii, getParliamentSizing } from "@/lib/charts/parliamentSizing";

export interface PartySeatsDisplay {
  party: string;
  partyName: string;
  partyColor: string;
  /** -5 left → +5 right, null = vacant */
  economicPosition: number | null;
  seats: number;
  /** Country ID for proper party logo lookup */
  countryId?: CountryId;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Sort parties left→right by economicPosition; vacant always last */
export function sortLR(seats: PartySeatsDisplay[]): PartySeatsDisplay[] {
  return [...seats].sort((a, b) => {
    if (a.party === "__vacant__") return 1;
    if (b.party === "__vacant__") return -1;
    return (a.economicPosition ?? 0) - (b.economicPosition ?? 0);
  });
}

// ── Parliament hemicycle SVG ──────────────────────────────────────────────────

/**
 * Traditional parliament/hemicycle chart.
 *
 * - Flat base at the bottom (the "well"), arc bows upward
 * - Left-wing parties on the left, right-wing on the right
 * - Seats form clean wedge-shaped sectors (not horizontal bands)
 *
 * Algorithm:
 *  1. Determine row count, distribute seats proportionally by arc length
 *  2. Generate dot positions for every row
 *  3. Sort ALL dots by angular fraction (t) so they go left → right
 *     across the entire semicircle regardless of row
 *  4. Assign party colors in that sorted order → creates radial wedges
 */
export function ParliamentChart({
  seats,
  total,
  coalitionView,
}: {
  seats: PartySeatsDisplay[];
  total: number;
  coalitionView?: CoalitionViewData | null;
}) {
  if (total === 0) return null;

  const cx = 200;
  const cy = 195;

  const sizing = getParliamentSizing(total);
  const { dotR, isSenate } = sizing;

  // 1. Determine rows needed (shared helper so client + server stay in sync)
  const { rowRadii, outerR } = computeRowRadii(sizing, total);

  // 2. Distribute seats across rows proportionally to arc length
  const totalArc = rowRadii.reduce((s, r) => s + Math.PI * r, 0);
  const rowSeats: number[] = [];
  let remaining = total;
  for (let i = 0; i < rowRadii.length; i++) {
    if (i === rowRadii.length - 1) {
      rowSeats.push(remaining);
    } else {
      const n = Math.round(((Math.PI * rowRadii[i]) / totalArc) * total);
      const capped = Math.min(n, remaining);
      rowSeats.push(capped);
      remaining -= capped;
    }
  }

  // 3. Generate dot positions with fractional parameter t ∈ [0, 1]
  //    t = 0 → leftmost (angle π), t = 1 → rightmost (angle 0)
  const dots: { x: number; y: number; t: number }[] = [];
  for (let row = 0; row < rowRadii.length; row++) {
    const r = rowRadii[row];
    const n = rowSeats[row];
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0.5;
      const angle = Math.PI * (1 - t); // π → 0 (left → right)
      dots.push({
        x: cx + r * Math.cos(angle),
        y: cy - r * Math.sin(angle),
        t,
      });
    }
  }

  // 4. Sort ALL dots by t (left → right) so colors form radial wedges
  dots.sort((a, b) => a.t - b.t);

  const vacantFill = "var(--card-border)";

  // 5. Build flat dot-data array based on view mode
  const dotData: { color: string; partyId: string; coalitionColor: string | null }[] = [];

  if (coalitionView) {
    // Coalition view: iterate coalition groups (sorted by economic position), then independents
    for (const group of coalitionView.coalitionGroups) {
      // Sort members by economic position for wedge effect
      const sortedMembers = [...group.members].sort(
        (a, b) => (a.economicPosition ?? 0) - (b.economicPosition ?? 0)
      );
      for (const party of sortedMembers) {
        for (let i = 0; i < party.seats; i++) {
          dotData.push({
            color: party.partyColor,
            partyId: party.party,
            coalitionColor: group.color,
          });
        }
      }
    }
    // Independents: sorted by economic position, no coalition color
    const sortedIndependents = [...coalitionView.independents].sort(
      (a, b) => (a.economicPosition ?? 0) - (b.economicPosition ?? 0)
    );
    for (const party of sortedIndependents) {
      for (let i = 0; i < party.seats; i++) {
        dotData.push({ color: party.partyColor, partyId: party.party, coalitionColor: null });
      }
    }
  } else {
    // Party mode: left→right order
    const ordered = sortLR(seats);
    for (const p of ordered) {
      for (let i = 0; i < p.seats; i++) {
        dotData.push({ color: p.partyColor, partyId: p.party, coalitionColor: null });
      }
    }
  }

  while (dotData.length < total) {
    dotData.push({ color: vacantFill, partyId: "__vacant__", coalitionColor: null });
  }

  // 6. Assign colors to sorted dots
  const coloredDots = dots.map((d, i) => ({ ...d, ...dotData[i] }));

  // Dynamic viewBox: grow horizontally/vertically whenever the arc geometry
  // would otherwise be clipped by the default 400 × 211 box (e.g. CN NPC at
  // 2980 seats). For chambers that already fit, vbX/vbY/vbW stay at the
  // legacy values so existing charts render identically.
  const labelPadX = 8;
  const halfW = Math.max(200, outerR + labelPadX);
  const vbX = cx - halfW;
  const vbW = halfW * 2;
  const labelPadTop = 12;
  const labelBaselineY = cy + 16; // matches the original svgH bottom edge
  const vbY = Math.min(0, cy - outerR - labelPadTop);
  const vbH = labelBaselineY - vbY;

  return (
    <svg
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      className="w-full"
      style={{ maxHeight: isSenate ? 190 : 210 }}
    >
      {/* Vertical center / majority line */}
      <line
        x1={cx}
        y1={cy - outerR - 8}
        x2={cx}
        y2={cy + 2}
        stroke="var(--card-border)"
        strokeWidth="1"
        strokeDasharray="4,3"
      />
      <text x={cx + 4} y={cy - outerR - 2} fill="var(--muted)" fontSize="8" fontFamily="sans-serif">
        ½
      </text>
      {/* Wing labels — anchored to viewBox edges so they stay in place even
          when the viewBox expands for very large chambers. */}
      <text x={vbX + 12} y={cy + 12} fill="var(--muted)" fontSize="8" fontFamily="sans-serif">
        ◄ Left
      </text>
      <text
        x={vbX + vbW - 12}
        y={cy + 12}
        fill="var(--muted)"
        fontSize="8"
        fontFamily="sans-serif"
        textAnchor="end"
      >
        Right ►
      </text>
      {/* Dots */}
      {coloredDots.map((d, i) =>
        d.coalitionColor ? (
          // Coalition member: diagonal split — bottom-left coalition color, top-right party color
          <g key={i}>
            {/* Top-right half: party color */}
            <path
              d={`M${d.x - dotR * 0.707},${d.y - dotR * 0.707} A${dotR},${dotR} 0 1,1 ${d.x + dotR * 0.707},${d.y + dotR * 0.707} Z`}
              fill={d.color}
            />
            {/* Bottom-left half: coalition color */}
            <path
              d={`M${d.x - dotR * 0.707},${d.y - dotR * 0.707} A${dotR},${dotR} 0 1,0 ${d.x + dotR * 0.707},${d.y + dotR * 0.707} Z`}
              fill={d.coalitionColor}
            />
          </g>
        ) : (
          // Independent or party mode: solid circle
          <circle key={i} cx={d.x} cy={d.y} r={dotR} fill={d.color} />
        )
      )}
    </svg>
  );
}

// ── Stacked seat bar ──────────────────────────────────────────────────────────

export function SeatBar({
  seats,
  total,
  coalitionView,
}: {
  seats: PartySeatsDisplay[];
  total: number;
  coalitionView?: CoalitionViewData | null;
}) {
  if (total === 0) return <div className="h-2 w-full rounded-full bg-card-border" />;

  if (coalitionView) {
    const filled =
      coalitionView.coalitionGroups.reduce((s, g) => s + g.totalSeats, 0) +
      coalitionView.independents.reduce((s, p) => s + p.seats, 0);
    const vacant = total - filled;

    return (
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-card-border">
        {/* Coalition segments */}
        {coalitionView.coalitionGroups.map((group) => (
          <div
            key={`coalition-${group.coalitionId}`}
            style={{
              width: `${(group.totalSeats / total) * 100}%`,
              backgroundColor: group.color,
              display: "flex",
              overflow: "hidden",
            }}
            title={`${group.name}: ${group.totalSeats}`}
          >
            {/* Inner party divisions at reduced opacity */}
            {group.members.map((party) => (
              <div
                key={party.party}
                style={{
                  flex: party.seats,
                  backgroundColor: party.partyColor,
                  opacity: 0.7,
                }}
                title={`${party.partyName}: ${party.seats}`}
              />
            ))}
          </div>
        ))}
        {/* Independent parties */}
        {coalitionView.independents.map((p) => (
          <div
            key={p.party}
            style={{ width: `${(p.seats / total) * 100}%`, backgroundColor: p.partyColor }}
            title={`${p.partyName}: ${p.seats}`}
          />
        ))}
        {/* Vacant */}
        {vacant > 0 && (
          <div
            style={{ width: `${(vacant / total) * 100}%`, backgroundColor: "var(--card-border)" }}
            title={`Vacant: ${vacant}`}
          />
        )}
      </div>
    );
  }

  const filled = seats.reduce((s, p) => s + p.seats, 0);
  const vacant = total - filled;
  const ordered = sortLR(seats);
  const bars: PartySeatsDisplay[] =
    vacant > 0
      ? [
          ...ordered,
          {
            party: "__vacant__",
            partyName: "Vacant",
            partyColor: "var(--card-border)",
            seats: vacant,
            economicPosition: null,
          },
        ]
      : ordered;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-card-border">
      {bars.map((p) => (
        <div
          key={p.party}
          style={{ width: `${(p.seats / total) * 100}%`, backgroundColor: p.partyColor }}
          title={`${p.partyName}: ${p.seats}`}
        />
      ))}
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

export function SeatLegend({
  seats,
  total,
  coalitionView,
}: {
  seats: PartySeatsDisplay[];
  total: number;
  coalitionView?: CoalitionViewData | null;
}) {
  if (coalitionView) {
    return (
      <div className="space-y-3">
        {/* Coalition group cards */}
        <div className="flex flex-wrap gap-3">
          {coalitionView.coalitionGroups.map((group) => (
            <div
              key={`coalition-${group.coalitionId}`}
              className="inline-flex flex-col rounded-lg border border-card-border p-2.5 max-w-sm"
              style={{ borderLeftWidth: 3, borderLeftColor: group.color }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: group.color }}
                />
                <span className="text-xs font-semibold text-foreground">{group.name}</span>
                <span className="text-xs font-bold tabular-nums" style={{ color: group.color }}>
                  {group.totalSeats}
                </span>
                <span className="text-[10px] text-muted/60 tabular-nums">
                  ({total > 0 ? ((group.totalSeats / total) * 100).toFixed(1) : "0"}%)
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 ml-[18px]">
                {group.members.map((p) => (
                  <div key={p.party} className="flex items-center gap-1.5">
                    <PartyLogo
                      partyId={p.party}
                      partyColor={p.partyColor}
                      countryId={p.countryId}
                      size="h-2.5 w-2.5"
                    />
                    <span className="text-xs text-muted">{p.partyName}</span>
                    <span
                      className="text-xs font-semibold tabular-nums"
                      style={{ color: p.partyColor }}
                    >
                      {p.seats}
                    </span>
                    <span className="text-[10px] text-muted/60 tabular-nums">
                      ({total > 0 ? ((p.seats / total) * 100).toFixed(1) : "0"}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Independent parties */}
        {coalitionView.independents.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {coalitionView.independents.map((p) => (
              <div key={p.party} className="flex items-center gap-1.5">
                <PartyLogo
                  partyId={p.party}
                  partyColor={p.partyColor}
                  countryId={p.countryId}
                  size="h-2.5 w-2.5"
                />
                <span className="text-xs text-muted">{p.partyName}</span>
                <span
                  className="text-xs font-semibold tabular-nums"
                  style={{ color: p.partyColor }}
                >
                  {p.seats}
                </span>
                <span className="text-[10px] text-muted/60 tabular-nums">
                  ({total > 0 ? ((p.seats / total) * 100).toFixed(1) : "0"}%)
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const ordered = sortLR(seats);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {ordered.map((p) => (
        <div key={p.party} className="flex items-center gap-1.5">
          <PartyLogo
            partyId={p.party}
            partyColor={p.partyColor}
            countryId={p.countryId}
            size="h-2.5 w-2.5"
          />
          <span className="text-xs text-muted">{p.partyName}</span>
          <span className="text-xs font-semibold tabular-nums" style={{ color: p.partyColor }}>
            {p.seats}
          </span>
          <span className="text-[10px] text-muted/60 tabular-nums">
            ({total > 0 ? ((p.seats / total) * 100).toFixed(1) : "0"}%)
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Majority banner ───────────────────────────────────────────────────────────

export function MajorityBanner({
  seats,
  total,
  chamberLabel,
}: {
  seats: PartySeatsDisplay[];
  total: number;
  chamberLabel: string;
}) {
  const majority = Math.floor(total / 2) + 1;
  const sorted = [...seats]
    .filter((p) => p.party !== "__vacant__")
    .sort((a, b) => b.seats - a.seats);
  const leader = sorted[0];

  if (!leader || total === 0) return null;

  const hasMajority = leader.seats >= majority;
  const tiedParties = sorted.filter((p) => p.seats === leader.seats);
  const isTied = tiedParties.length > 1;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
        hasMajority
          ? "bg-green-500/10 border border-green-500/20 text-green-400"
          : "bg-yellow-500/10 border border-yellow-500/20 text-yellow-400"
      }`}
    >
      <PartyLogo
        partyId={leader.party}
        partyColor={leader.partyColor}
        countryId={leader.countryId}
        size="h-2 w-2"
      />
      {hasMajority ? (
        <>
          <strong>{leader.partyName}</strong>&nbsp;holds {chamberLabel} majority ({leader.seats} /{" "}
          {majority} needed)
        </>
      ) : isTied ? (
        <>
          <strong>{tiedParties.map((p) => p.partyName).join(" & ")}</strong>&nbsp;tied in{" "}
          {chamberLabel} ({leader.seats} seats each · {majority} needed for majority)
        </>
      ) : (
        <>
          <strong>{leader.partyName}</strong>&nbsp;leads {chamberLabel} ({leader.seats} seats ·{" "}
          {majority} needed for majority)
        </>
      )}
    </div>
  );
}

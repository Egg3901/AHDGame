"use client";

import { useTranslations } from "next-intl";
import { partyFallbackColor, STATE_EV } from "./electionHelpers";

interface StatePVDonutProps {
  entries: [string, number][];
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  partyColors?: Record<string, string>;
  stateId: string;
}

/** Larger multi-slice donut for state-level presidential PV. */
export function StatePVDonut({
  entries,
  candidateNames,
  candidateParties,
  partyColors,
  stateId,
}: StatePVDonutProps) {
  const t = useTranslations("elections");
  const size = 120;
  const cx = size / 2;
  const cy = size / 2;
  const r = 50;
  const innerR = 30;
  const total = entries.reduce((s, [, v]) => s + v, 0);

  let cumAngle = -Math.PI / 2;
  const slices = entries.map(([cid, votes]) => {
    const frac = total > 0 ? votes / total : 0;
    const angle = frac * 2 * Math.PI;
    const start = cumAngle;
    // eslint-disable-next-line react-hooks/immutability
    cumAngle += angle;
    return { cid, votes, frac, startAngle: start, endAngle: cumAngle };
  });

  function arcPath(sa: number, ea: number) {
    const x1 = cx + r * Math.cos(sa);
    const y1 = cy + r * Math.sin(sa);
    const x2 = cx + r * Math.cos(ea);
    const y2 = cy + r * Math.sin(ea);
    const ix1 = cx + innerR * Math.cos(ea);
    const iy1 = cy + innerR * Math.sin(ea);
    const ix2 = cx + innerR * Math.cos(sa);
    const iy2 = cy + innerR * Math.sin(sa);
    const large = ea - sa > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${large} 0 ${ix2} ${iy2} Z`;
  }

  const ev = STATE_EV[stateId] ?? "?";
  const winner = entries[0];
  const winnerPct = total > 0 ? ((winner[1] / total) * 100).toFixed(1) : "0";
  const winnerParty = (candidateParties[winner[0]] ?? "independent").toLowerCase();
  const winnerColor = partyColors?.[winnerParty] ?? partyFallbackColor(winnerParty);

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <svg width={size} height={size}>
          {slices.map((s) => {
            if (s.frac < 0.005) return null;
            const party = (candidateParties[s.cid] ?? "independent").toLowerCase();
            const color = partyColors?.[party] ?? partyFallbackColor(party);
            return (
              <path
                key={s.cid}
                d={arcPath(s.startAngle, s.endAngle)}
                fill={color}
                stroke="#0f172a"
                strokeWidth={0.8}
              />
            );
          })}
          <circle cx={cx} cy={cy} r={innerR - 1} fill="#0f172a" />
          <text
            x={cx}
            y={cy - 7}
            textAnchor="middle"
            fill={winnerColor}
            fontSize={13}
            fontWeight={700}
          >
            {winnerPct}%
          </text>
          <text x={cx} y={cy + 7} textAnchor="middle" fill="#94a3b8" fontSize={9}>
            {t("statePV.statePV")}
          </text>
        </svg>
        <div
          className="absolute -bottom-1 -right-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white"
          style={{ backgroundColor: winnerColor }}
        >
          {t("statePV.ev", { count: ev })}
        </div>
      </div>
      <div className="space-y-1.5 min-w-0">
        {entries.map(([cid, votes]) => {
          const party = (candidateParties[cid] ?? "independent").toLowerCase();
          const color = partyColors?.[party] ?? partyFallbackColor(party);
          const name = candidateNames[cid] ?? t("card.unknownCandidate");
          const pct = total > 0 ? (votes / total) * 100 : 0;
          return (
            <div key={cid}>
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="inline-block h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs font-medium truncate">{name}</span>
                </div>
                <span className="text-xs font-semibold tabular-nums shrink-0" style={{ color }}>
                  {pct.toFixed(1)}%
                </span>
              </div>
              <div className="h-1 bg-card-border rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

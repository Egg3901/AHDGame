"use client";

import type { CSSProperties } from "react";
import type {
  RecapActivity,
  RecapCareerMark,
  RecapCareerStep,
  RecapRace,
  RecapWealthSeries,
} from "@/lib/recap/types";
import { fmt, monthYear, pct } from "@/lib/recap/format";

/**
 * The Wrapped charts. One rule holds across all of them: the player's party
 * color marks the player, everything else is white at some opacity. Motion is
 * CSS-only (keyframes in `WRAPPED_KEYFRAMES`) so a chart animates the moment
 * its slide mounts and renders final-state when motion is off.
 */

export const WRAPPED_KEYFRAMES = `
@keyframes ahdw-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes ahdw-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes ahdw-widen{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes ahdw-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes ahdw-fade{from{opacity:0}to{opacity:1}}
@keyframes ahdw-progress{from{width:0%}to{width:100%}}
@keyframes ahdw-pop{0%{opacity:0;transform:scale(.4)}70%{opacity:1;transform:scale(1.15)}100%{opacity:1;transform:scale(1)}}
`;

export function anim(
  motion: boolean,
  name: string,
  ms: number,
  delay = 0,
  extra?: CSSProperties
): CSSProperties | undefined {
  if (!motion) return extra;
  return {
    animation: `${name} ${ms}ms cubic-bezier(.16,1,.3,1) ${delay}ms both`,
    ...extra,
  };
}

// ── Season strip ───────────────────────────────────────────────────────────

export function SeasonStrip({
  activity,
  marks,
  accent,
  motion,
  height = 150,
  drawMs = 1400,
}: {
  activity: RecapActivity;
  marks?: RecapCareerMark[];
  accent: string;
  motion: boolean;
  height?: number;
  drawMs?: number;
}) {
  const W = 1000;
  const top = 26;
  const n = activity.bins.length;
  const span = n * activity.binTurns;
  const max = Math.max(1, ...activity.bins);
  const bw = W / n;
  const xOf = (turn: number) => Math.max(0, Math.min(W, ((turn - activity.startTurn) / span) * W));
  const plotted = (marks ?? []).filter((m) => m.kind === "won" || m.kind === "lost");
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
      role="img"
      aria-label={`Actions per stretch of the season, peaking at ${fmt(max)}`}
    >
      {activity.bins.map((v, i) => {
        const h = v > 0 ? Math.max(3, ((height - top) * v) / max) : 1.5;
        return (
          <rect
            key={i}
            x={i * bw + bw * 0.14}
            y={height - h}
            width={bw * 0.72}
            height={h}
            fill={v > 0 ? accent : "rgba(255,255,255,.18)"}
            style={anim(motion, "ahdw-grow", 600, (i / n) * drawMs, {
              transformOrigin: `0 ${height}px`,
              transformBox: "view-box",
            })}
          />
        );
      })}
      {plotted.map((m, i) => {
        const x = xOf(m.turn);
        return (
          <g key={`${m.turn}-${i}`} style={anim(motion, "ahdw-fade", 300, ((x / W) * drawMs) | 0)}>
            <line
              x1={x}
              x2={x}
              y1={4}
              y2={top - 6}
              stroke={m.kind === "won" ? "#fff" : "rgba(255,255,255,.4)"}
              strokeWidth={m.kind === "won" ? 3 : 2}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </svg>
  );
}

// ── Career ladder ──────────────────────────────────────────────────────────

export function CareerLadder({
  climb,
  accent,
  motion,
}: {
  climb: RecapCareerStep[];
  accent: string;
  motion: boolean;
}) {
  const steps = [...climb].reverse(); // highest first, read top-down
  const per = 520 / Math.max(1, steps.length);
  return (
    <ol className="relative ml-1.5 flex flex-col gap-6 border-l border-white/15 pl-6">
      <span
        aria-hidden
        className="absolute -left-px top-0 w-[2px]"
        style={{
          height: "100%",
          background: accent,
          transformOrigin: "bottom",
          ...anim(motion, "ahdw-grow", 1200, 150),
        }}
      />
      {steps.map((s, i) => {
        const delay = 150 + (steps.length - 1 - i) * per;
        const isTop = i === 0;
        return (
          <li
            key={`${s.label}-${s.turn}`}
            className="relative"
            style={anim(motion, "ahdw-rise", 500, delay)}
          >
            <span
              aria-hidden
              className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full"
              style={{ background: isTop ? accent : "#000", border: `2px solid ${accent}` }}
            />
            <p className="text-[13px] tabular-nums text-white/55">{monthYear(s.date)}</p>
            <p
              className={`text-balance font-semibold leading-tight tracking-[-0.01em] ${
                isTop ? "text-[22px] text-white" : "text-[17px] text-white/80"
              }`}
            >
              {s.label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

// ── Race result ────────────────────────────────────────────────────────────

export function RaceBars({
  race,
  accent,
  motion,
  delay = 0,
}: {
  race: RecapRace;
  accent: string;
  motion: boolean;
  delay?: number;
}) {
  const max = Math.max(1, ...race.field.map((c) => c.share));
  return (
    <ul className="flex flex-col gap-3.5">
      {race.field.map((c, i) => (
        <li key={`${c.name}-${i}`} style={anim(motion, "ahdw-rise", 450, delay + i * 90)}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate">
              <span
                className="text-[16px] font-semibold"
                style={{ color: c.isYou ? accent : "rgba(255,255,255,.9)" }}
              >
                {c.name}
              </span>
              <span className="ml-2 text-[13px] text-white/45">{c.partyName}</span>
            </p>
            <p className="shrink-0 text-[15px] font-semibold tabular-nums text-white/85">
              {pct(c.share)}
            </p>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(c.share / max) * 100}%`,
                background: c.isYou ? accent : "rgba(255,255,255,.35)",
                transformOrigin: "left",
                ...anim(motion, "ahdw-widen", 900, delay + 200 + i * 90),
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Roll call ──────────────────────────────────────────────────────────────

/**
 * 100 seats in proportion to the tally: filled = for, ring = against, faint =
 * abstain. One seat in the player's color marks where their own vote fell.
 */
export function RollCall({
  tally,
  yourVote,
  accent,
  motion,
  delay = 0,
}: {
  tally: { for: number; against: number; abstain: number };
  yourVote: "for" | "against" | "abstain" | null;
  accent: string;
  motion: boolean;
  delay?: number;
}) {
  const total = Math.max(1, tally.for + tally.against + tally.abstain);
  const nFor = Math.round((tally.for / total) * 100);
  const nAgainst = Math.round((tally.against / total) * 100);
  const seats: Array<"for" | "against" | "abstain"> = [];
  for (let i = 0; i < 100; i++)
    seats.push(i < nFor ? "for" : i < nFor + nAgainst ? "against" : "abstain");
  const mine =
    yourVote === "for"
      ? Math.max(0, nFor - 1)
      : yourVote === "against"
        ? Math.min(99, nFor + Math.max(0, nAgainst - 1))
        : yourVote === "abstain"
          ? 99
          : -1;
  return (
    <div className="grid gap-[5px]" style={{ gridTemplateColumns: "repeat(20, 1fr)" }}>
      {seats.map((s, i) => {
        const me = i === mine;
        const style: CSSProperties = me
          ? { background: accent }
          : s === "for"
            ? { background: "rgba(255,255,255,.88)" }
            : s === "against"
              ? { boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,.55)" }
              : { background: "rgba(255,255,255,.12)" };
        return (
          <span
            key={i}
            className="aspect-square rounded-full"
            style={{
              ...style,
              ...anim(
                motion,
                me ? "ahdw-pop" : "ahdw-fade",
                me ? 500 : 220,
                delay + i * 9 + (me ? 500 : 0)
              ),
            }}
          />
        );
      })}
    </div>
  );
}

// ── Wealth line ────────────────────────────────────────────────────────────

export function WealthLine({
  wealth,
  accent,
  motion,
  height = 150,
}: {
  wealth: RecapWealthSeries;
  accent: string;
  motion: boolean;
  height?: number;
}) {
  const W = 1000;
  const pad = 10;
  const pts = wealth.points;
  const min = Math.min(0, ...pts);
  const max = Math.max(...pts, min + 1);
  const x = (i: number) => (i / Math.max(1, pts.length - 1)) * W;
  const y = (v: number) => pad + (height - 2 * pad) * (1 - (v - min) / (max - min));
  const line = pts
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join("");
  const area = `${line}L${W},${height}L0,${height}Z`;
  const peakIdx = pts.indexOf(Math.max(...pts));
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
      role="img"
      aria-label="Personal fortune over the season"
    >
      <path d={area} fill={accent} fillOpacity={0.14} style={anim(motion, "ahdw-fade", 900, 700)} />
      <path
        d={line}
        fill="none"
        stroke={accent}
        strokeWidth={2.5}
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        strokeDasharray={1}
        style={anim(motion, "ahdw-draw", 1500, 150)}
      />
      {peakIdx >= 0 && (
        <line
          x1={x(peakIdx)}
          x2={x(peakIdx)}
          y1={y(pts[peakIdx])}
          y2={height}
          stroke="rgba(255,255,255,.5)"
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
          style={anim(motion, "ahdw-fade", 400, 1500)}
        />
      )}
    </svg>
  );
}

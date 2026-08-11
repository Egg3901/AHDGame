"use client";

import { useMemo, useState } from "react";
import {
  computeGroupPartyMatches,
  computeStateProjection,
  classifyLean,
  type PartyMatch,
  type RegionPartyPosition,
} from "@/lib/demographics/preferredParty";
import type { BucketProfileSection } from "@/lib/demographics/bucketProfile";

/**
 * Strategy board for a region's electorate, read in Layer-1 buckets.
 *
 * This replaced an archetype roster. Archetypes are an authoring format, not
 * what the vote engine counts, so the old board showed a projection of the
 * electorate rather than the electorate itself — and outside the US the
 * projection was lossy enough to disagree with the result.
 *
 * One dimension is shown at a time. Each dimension partitions the same voters,
 * so shares sum to 100 within a dimension but would sum to 100 PER dimension if
 * they were flattened together — a single mixed list would silently double-count
 * every voter.
 */

interface BucketRowView {
  id: string;
  label: string;
  glyph: string;
  sharePct: number;
  economicLean: number;
  socialLean: number;
  turnout: number;
  matches: PartyMatch[];
  lean: ReturnType<typeof classifyLean>;
}

interface Coalition {
  key: string;
  title: string;
  color: string;
  members: BucketRowView[];
  pct: number;
}

function leanColor(v: number): string {
  if (v < -0.4) return "#60a5fa";
  if (v > 0.4) return "#f87171";
  return "#94a3b8";
}
function fmtLean(v: number): string {
  return (v >= 0 ? "+" : "") + v.toFixed(1);
}
function leanTextClass(v: number): string {
  if (v < -0.4) return "text-info";
  if (v > 0.4) return "text-error";
  return "text-secondary";
}
function econWord(v: number): string {
  if (v <= -2) return "Left";
  if (v < -0.4) return "Center-left";
  if (v <= 0.4) return "Centrist";
  if (v < 2) return "Center-right";
  return "Right";
}
function socWord(v: number): string {
  if (v <= -2) return "Progressive";
  if (v < -0.4) return "Liberal";
  if (v <= 0.4) return "Moderate";
  if (v < 2) return "Traditional";
  return "Very traditional";
}
function turnoutWord(t: number): string {
  if (t >= 70) return "Reliable";
  if (t >= 50) return "Occasional";
  return "Low-propensity";
}
function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

export function ElectorateDossier({
  profile,
  regionParties,
}: {
  profile: BucketProfileSection[];
  regionParties: RegionPartyPosition[];
}) {
  const [view, setView] = useState<"simple" | "analyst">("simple");
  const [dim, setDim] = useState<string>(profile[0]?.dim ?? "");

  const section = profile.find((s) => s.dim === dim) ?? profile[0] ?? null;

  const groups: BucketRowView[] = useMemo(() => {
    if (!section) return [];
    return section.buckets
      .filter((b) => b.sharePct > 0)
      .sort((a, b) => b.sharePct - a.sharePct)
      .map((b) => {
        const matches = computeGroupPartyMatches(b.economicLean, b.socialLean, regionParties);
        return {
          id: b.id,
          label: b.label,
          glyph: initials(b.label),
          sharePct: b.sharePct,
          economicLean: b.economicLean,
          socialLean: b.socialLean,
          turnout: b.turnout,
          matches,
          lean: classifyLean(matches),
        };
      });
  }, [section, regionParties]);

  // Weight by expected voters, not headcount — the same weighting the engine
  // uses. Every dimension partitions the same electorate, so this projection is
  // the same number whichever dimension is on screen.
  const projection = useMemo(
    () =>
      computeStateProjection(
        groups.map((g) => ({
          economicLean: g.economicLean,
          socialLean: g.socialLean,
          weight: g.sharePct * (g.turnout > 0 ? g.turnout / 100 : 1),
        })),
        regionParties
      ),
    [groups, regionParties]
  );

  const coalitions: Coalition[] = useMemo(() => {
    const byKey = new Map<string, BucketRowView[]>();
    for (const g of groups) {
      const key = g.lean.isTossUp ? "__tossup" : (g.lean.partyId ?? "__tossup");
      const arr = byKey.get(key) ?? [];
      arr.push(g);
      byKey.set(key, arr);
    }
    const build = (key: string, title: string, color: string): Coalition | null => {
      const members = byKey.get(key);
      if (!members || members.length === 0) return null;
      members.sort((a, b) => b.sharePct - a.sharePct);
      return { key, title, color, members, pct: members.reduce((s, m) => s + m.sharePct, 0) };
    };
    const tossup = build("__tossup", "Persuadable", "#94a3b8");
    const partyCoalitions = regionParties
      .map((p) => build(p.partyId, `Leans ${p.abbreviation}`, p.color))
      .filter((c): c is Coalition => c !== null);
    const ordered: Coalition[] = [];
    if (partyCoalitions[0]) ordered.push(partyCoalitions[0]);
    if (tossup) ordered.push(tossup);
    ordered.push(...partyCoalitions.slice(1));
    return ordered;
  }, [groups, regionParties]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = groups.find((g) => g.id === selectedId) ?? groups[0] ?? null;

  if (!section || groups.length === 0) return null;

  const projTotal = projection.reduce((s, p) => s + p.matchPct, 0) || 100;
  const leader = projection[0];
  const runnerUp = projection[1];
  const marginLabel = leader
    ? runnerUp
      ? `${leader.abbreviation} +${leader.matchPct - runnerUp.matchPct}`
      : `${leader.abbreviation} ${leader.matchPct}%`
    : "—";

  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card">
      {/* toolbar: title + Simple/Analyst view */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-card-border bg-card-muted/30 px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          Electorate — strategy board
        </span>
        <div className="flex overflow-hidden rounded-lg border border-card-border">
          {(["simple", "analyst"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3.5 py-1.5 text-xs font-semibold capitalize transition-colors ${
                view === v ? "bg-primary/15 text-primary" : "text-muted hover:text-foreground"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* dimension selector — one cut of the electorate at a time */}
      <div className="flex flex-wrap gap-1.5 border-b border-card-border px-4 py-2.5">
        {profile.map((s) => (
          <button
            key={s.dim}
            onClick={() => {
              setDim(s.dim);
              setSelectedId(null);
            }}
            className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
              s.dim === section.dim
                ? "bg-primary/15 text-primary"
                : "text-muted hover:text-foreground"
            }`}
          >
            {s.dimLabel}
          </button>
        ))}
      </div>

      {/* projection band with 50% flip line */}
      {projection.length > 0 && (
        <div className="border-b border-card-border px-5 py-4">
          <div className="mb-2 flex flex-wrap items-baseline gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              State Projection
            </span>
            <span
              className="text-xl font-bold tabular-nums"
              style={{ color: leader?.color ?? "var(--foreground)" }}
            >
              {marginLabel}
            </span>
          </div>
          <div className="relative">
            <div className="flex h-4 overflow-hidden rounded-full bg-card-border/40">
              {projection.map((p) => (
                <div
                  key={p.partyId}
                  style={{ width: `${(p.matchPct / projTotal) * 100}%`, backgroundColor: p.color }}
                  title={`${p.name} ${p.matchPct}%`}
                />
              ))}
            </div>
            <div
              aria-hidden
              className="absolute -top-1 -bottom-1 left-1/2 w-0.5 -translate-x-1/2 rounded bg-foreground/70"
            />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[11px] text-muted">
            {projection.map((p) => (
              <span key={p.partyId}>
                {p.name} <b style={{ color: p.color }}>{p.matchPct}%</b>
              </span>
            ))}
            <span className="text-muted/70">50% flip line</span>
          </div>
        </div>
      )}

      {/* coalition summary */}
      {coalitions.length > 0 && (
        <div className="grid gap-3 border-b border-card-border px-5 py-4 sm:grid-cols-3">
          {coalitions.map((c) => (
            <div
              key={c.key}
              className="rounded-xl border p-3"
              style={{ borderColor: `${c.color}55`, backgroundColor: `${c.color}12` }}
            >
              <div className="flex items-baseline justify-between">
                <span
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: c.color }}
                >
                  {c.title}
                </span>
                <span className="text-[11px] text-muted">{c.members.length} groups</span>
              </div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: c.color }}>
                {c.pct.toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,380px)_1fr]">
        {/* roster grouped by coalition */}
        <div className="max-h-[720px] overflow-y-auto border-b border-card-border md:border-b-0 md:border-r">
          {coalitions.map((c) => (
            <div key={c.key}>
              <div className="sticky top-0 z-[1] flex items-center justify-between bg-card px-4 pb-2 pt-3">
                <span
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: c.color }}
                >
                  {c.title}
                </span>
                <span className="text-[11px] tabular-nums text-muted">{c.pct.toFixed(0)}%</span>
              </div>
              {c.members.map((g) => {
                const isSel = g.id === selected?.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => setSelectedId(g.id)}
                    className={`flex w-full items-center gap-3 border-l-2 px-4 py-2.5 text-left transition-colors ${
                      isSel
                        ? "border-primary bg-card-elevated/40"
                        : "border-transparent hover:bg-card-elevated/20"
                    }`}
                  >
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
                      style={{
                        backgroundColor: `${leanColor(g.economicLean)}22`,
                        color: leanColor(g.economicLean),
                        border: `1px solid ${leanColor(g.economicLean)}55`,
                      }}
                    >
                      {g.glyph}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-foreground">
                          {g.label}
                        </span>
                        <span className="shrink-0 text-[13px] font-bold tabular-nums text-foreground">
                          {g.sharePct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-card-border/40">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(g.sharePct, 100)}%`,
                            backgroundColor: leanColor(g.economicLean),
                          }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* dossier */}
        {selected && (
          <div className="p-5">
            <div className="mb-4 flex items-start gap-4">
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-2xl font-bold"
                style={{
                  backgroundColor: `${leanColor(selected.economicLean)}22`,
                  color: leanColor(selected.economicLean),
                  border: `1px solid ${leanColor(selected.economicLean)}55`,
                }}
              >
                {selected.glyph}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-bold text-foreground">{selected.label}</h3>
                  <span
                    className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    style={{
                      color: selected.lean.color,
                      backgroundColor: `${selected.lean.color}22`,
                    }}
                  >
                    {selected.lean.label}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-muted">
                  {section.dimLabel} · {selected.sharePct.toFixed(1)}% of this region&apos;s voters
                </p>
              </div>
            </div>

            {/* real stat tiles (both views) */}
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-card-border bg-card-muted/30 px-3 py-2.5">
                <div className="text-[9px] uppercase tracking-widest text-muted">
                  Share of electorate
                </div>
                <div className="text-xl font-bold tabular-nums text-foreground">
                  {selected.sharePct.toFixed(1)}%
                </div>
              </div>
              <div className="rounded-xl border border-card-border bg-card-muted/30 px-3 py-2.5">
                <div className="text-[9px] uppercase tracking-widest text-muted">Turnout habit</div>
                <div className="text-sm font-bold text-foreground">
                  {turnoutWord(selected.turnout)}
                </div>
                <div className="text-[11px] text-muted">{selected.turnout.toFixed(0)}% show up</div>
              </div>
              <div
                className="rounded-xl border bg-card-muted/30 px-3 py-2.5"
                style={{ borderColor: `${selected.lean.color}55` }}
              >
                <div className="text-[9px] uppercase tracking-widest text-muted">
                  Leaning toward
                </div>
                <div className="text-sm font-bold" style={{ color: selected.lean.color }}>
                  {selected.lean.isTossUp
                    ? "No clear favorite"
                    : (selected.matches[0]?.name ?? "—")}
                </div>
                <div className="text-[11px] text-muted">
                  {selected.lean.isTossUp ? "Persuadable" : "Closest platform match"}
                </div>
              </div>
            </div>

            {/* Analyst-only detail */}
            {view === "analyst" && (
              <>
                <div className="mb-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-card-border bg-card-muted/30 px-3 py-2.5">
                    <div className="text-[9px] uppercase tracking-widest text-muted">
                      Economic lean
                    </div>
                    <div className={`text-sm font-bold ${leanTextClass(selected.economicLean)}`}>
                      {econWord(selected.economicLean)}
                    </div>
                    <div className="text-[11px] text-muted">
                      {fmtLean(selected.economicLean)} / ±5
                    </div>
                  </div>
                  <div className="rounded-xl border border-card-border bg-card-muted/30 px-3 py-2.5">
                    <div className="text-[9px] uppercase tracking-widest text-muted">
                      Social lean
                    </div>
                    <div className={`text-sm font-bold ${leanTextClass(selected.socialLean)}`}>
                      {socWord(selected.socialLean)}
                    </div>
                    <div className="text-[11px] text-muted">
                      {fmtLean(selected.socialLean)} / ±5
                    </div>
                  </div>
                </div>

                {selected.matches.length > 0 && (
                  <div className="mb-4">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
                      Party match
                    </div>
                    <div className="space-y-2">
                      {selected.matches.map((m) => (
                        <div key={m.partyId}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2 font-medium text-foreground">
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: m.color }}
                              />
                              {m.name}
                            </span>
                            <span className="font-bold tabular-nums" style={{ color: m.color }}>
                              {m.matchPct}%
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-card-border/40">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${m.matchPct}%`, backgroundColor: m.color }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

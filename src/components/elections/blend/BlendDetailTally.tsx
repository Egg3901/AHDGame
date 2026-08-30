"use client";

/**
 * The Blend detail count: serif candidate rows that expand to show the
 * arithmetic behind the seat figure.
 *
 * Expanding is the point of this panel. "REP takes 9 of 19" is an assertion;
 * the open row shows the quota it was bought at, the whole quotas, and the
 * remainder that won the rest, so a player can check the result rather than
 * take it on trust.
 */

import React, { useState } from "react";
import Link from "next/link";
import type { BlendDetailModel, BlendDetailTallyRow } from "@/lib/elections/blendDetailViewModel";

interface BlendDetailTallyProps {
  model: BlendDetailModel;
  /** Endorse control per candidate. Omitted when the viewer cannot endorse. */
  renderEndorse?: (candidateId: string) => React.ReactNode;
  /** Profile link per candidate. */
  hrefFor?: (row: BlendDetailTallyRow) => string | null;
}

export function BlendDetailTally({ model, renderEndorse, hrefFor }: BlendDetailTallyProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="flex items-center gap-2.5 border-b border-card-border px-4 py-3">
        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-muted">
          {model.tallyTitle}
        </span>
        <div className="flex-1" />
        <span className="text-[11px] tabular-nums text-muted">{model.tallyMeta}</span>
      </div>

      {model.rows.length === 0 && (
        <p className="px-4 py-6 text-sm text-muted">No candidates in this race.</p>
      )}

      {model.rows.map((row) => {
        const isOpen = !!open[row.candidateId];
        const href = hrefFor?.(row) ?? null;
        return (
          <div key={row.candidateId} className="border-b border-card-border/60 last:border-b-0">
            <button
              type="button"
              onClick={() => setOpen((s) => ({ ...s, [row.candidateId]: !s[row.candidateId] }))}
              aria-expanded={isOpen}
              className="flex w-full cursor-pointer items-center gap-3.5 border-none bg-transparent px-4 py-4 text-left text-inherit"
            >
              <span
                className="h-[42px] w-1 shrink-0 rounded-sm"
                style={{ background: row.color }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-serif text-xl font-semibold tracking-tight text-foreground">
                  {row.name}
                  {row.isYou && <span className="text-muted"> (you)</span>}
                </div>
                <div className="mt-0.5 truncate text-[11px] tracking-wide text-muted">
                  {row.partyName}
                  {row.isNPP && <span className="ml-1.5 opacity-70">NPP</span>}
                </div>
              </div>

              <div className="w-[92px] shrink-0 text-right">
                <div
                  className="font-serif text-2xl font-bold tabular-nums tracking-tight"
                  style={{ color: row.color }}
                >
                  {row.pctStr}%
                </div>
                <div className="text-[11px] tabular-nums text-muted">{row.votesStr} votes</div>
              </div>

              {model.showSeatCol && (
                <div className="w-[72px] shrink-0 border-l border-card-border pl-3.5 text-right">
                  <div className="font-serif text-2xl font-bold tabular-nums text-foreground">
                    {row.seatsCell}
                  </div>
                  <div className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-muted">
                    {row.seatWord}
                  </div>
                </div>
              )}

              {row.isWinner && !model.showSeatCol && (
                <div className="w-[72px] shrink-0 border-l border-card-border pl-3.5 text-right">
                  <div className="font-serif text-2xl leading-tight text-warning">★</div>
                  <div className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-warning">
                    Elected
                  </div>
                </div>
              )}

              <span className="w-3.5 shrink-0 text-center text-[13px] text-muted" aria-hidden>
                {isOpen ? "▾" : "▸"}
              </span>
            </button>

            {/* The repo's `fadeIn` is already the mockup's rise: opacity in,
                6px up. No need for a second keyframe. */}
            {isOpen && (
              <div className="animate-[fadeIn_.18s_ease-out] px-4 pb-4 pl-9">
                <p className="mb-3.5 max-w-[640px] font-serif text-base leading-relaxed text-foreground/80">
                  {row.mathNote}
                </p>
                <div className="flex flex-wrap gap-6">
                  {row.math.map((m) => (
                    <div key={m.key}>
                      <div className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-muted">
                        {m.key}
                      </div>
                      <div
                        className="font-serif text-lg font-bold tabular-nums"
                        style={m.color ? { color: m.color } : undefined}
                      >
                        {m.value}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {href && (
                    <Link
                      href={href}
                      className="font-serif text-sm italic text-primary hover:underline"
                    >
                      View profile &rarr;
                    </Link>
                  )}
                  {renderEndorse?.(row.candidateId)}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

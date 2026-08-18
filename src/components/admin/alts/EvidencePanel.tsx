"use client";

// EvidencePanel (plan §4.8): per-pair concrete evidence — the matched
// fingerprint prefix, masked shared IP, coordinated funding chain, referral,
// common victims. One expandable row per linked pair, ranked by link
// confidence, so a moderator sees at least one concrete piece of evidence for
// every suspected link. Selecting an edge in the RingGraph focuses its row.

import { useEffect, useMemo, useRef } from "react";
import { ConfidenceBar } from "./ConfidenceMeter";
import {
  memberInGameName,
  pairKey,
  signalMeta,
  TIER_HEX,
  type ClusterLink,
  type ClusterMember,
} from "./altTypes";

interface EvidencePanelProps {
  links: ClusterLink[];
  members: ClusterMember[];
  selectedPair?: string | null;
  onSelectPair?: (pair: string | null) => void;
  /** Admin sees un-redacted evidence fragments (masked IP octet / fingerprint
   * prefix); moderators get `[ip]`/`[fingerprint]` placeholders (enforced
   * server-side — this flag only drives the reveal affordance / labelling). */
  isAdmin: boolean;
}

export function EvidencePanel({
  links,
  members,
  selectedPair,
  onSelectPair,
  isAdmin,
}: EvidencePanelProps) {
  const nameOf = useMemo(() => {
    const map = new Map(members.map((m) => [m.userId, memberInGameName(m)]));
    return (id: string) => map.get(id) ?? `user·${id.slice(-6)}`;
  }, [members]);

  const sortedLinks = useMemo(
    () => [...links].sort((a, b) => b.confidence - a.confidence),
    [links]
  );

  if (links.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-card-border px-4 py-8 text-center text-sm text-muted">
        No pairwise links recorded for this cluster.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          Evidence by pair
        </h4>
        <span className="text-xs text-muted">
          {links.length} link{links.length === 1 ? "" : "s"}
          {isAdmin ? " · un-redacted (admin)" : " · network details masked"}
        </span>
      </div>
      {sortedLinks.map((link) => {
        const key = pairKey(link.userA, link.userB);
        return (
          <PairRow
            key={key}
            pairId={key}
            link={link}
            aName={nameOf(link.userA)}
            bName={nameOf(link.userB)}
            selected={selectedPair === key}
            onSelect={() => onSelectPair?.(selectedPair === key ? null : key)}
          />
        );
      })}
    </div>
  );
}

interface PairRowProps {
  pairId: string;
  link: ClusterLink;
  aName: string;
  bName: string;
  selected: boolean;
  onSelect: () => void;
}

function PairRow({ pairId, link, aName, bName, selected, onSelect }: PairRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selected]);

  const firing = link.signals.filter((s) => s.weight > 0);
  const guarded = link.signals.filter((s) => s.weight <= 0);

  return (
    <div
      ref={rowRef}
      id={`pair-${pairId}`}
      className={`overflow-hidden rounded-lg border transition-colors motion-reduce:transition-none ${
        selected
          ? "border-primary/50 bg-primary/[0.06] ring-1 ring-primary/25"
          : "border-card-border bg-card"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={selected}
        className="flex w-full flex-wrap items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-card-elevated/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
      >
        <svg
          className={`h-3.5 w-3.5 flex-shrink-0 text-muted transition-transform motion-reduce:transition-none ${selected ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-sm font-medium">
          {aName} <span className="px-0.5 text-muted">↔</span> {bName}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex flex-wrap justify-end gap-1">
            {firing.slice(0, 4).map((s, i) => {
              const meta = signalMeta(s.type);
              return (
                <span
                  key={i}
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: `${TIER_HEX[meta.tier]}1f`,
                    color: TIER_HEX[meta.tier],
                  }}
                >
                  {meta.label}
                </span>
              );
            })}
            {firing.length > 4 && (
              <span className="self-center text-[10px] text-muted">+{firing.length - 4}</span>
            )}
          </div>
          <ConfidenceBar value={link.confidence} widthClass="w-16" />
        </div>
      </button>

      {selected && (
        <div className="space-y-2.5 border-t border-card-border/70 px-3 py-3">
          {firing.map((s, i) => {
            const meta = signalMeta(s.type);
            return (
              <div key={i} className="flex items-start gap-2.5 text-sm">
                <span
                  className="mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: TIER_HEX[meta.tier] }}
                />
                <div className="min-w-0">
                  <span className="font-medium">{meta.label}</span>
                  <span className="ml-2 font-mono text-[11px] text-muted">
                    w {s.weight.toFixed(2)}
                  </span>
                  <p className="text-xs leading-relaxed text-muted">{s.evidence}</p>
                </div>
              </div>
            );
          })}
          {guarded.length > 0 && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
              <p className="mb-1 text-[11px] font-semibold text-emerald-400">
                Guarded to zero (not counted)
              </p>
              {guarded.map((s, i) => (
                <p key={i} className="text-xs leading-relaxed text-muted">
                  <span className="font-medium text-foreground/70">
                    {signalMeta(s.type).label}:
                  </span>{" "}
                  {s.evidence}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

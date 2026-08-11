"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { PartyLogo } from "@/components/PartyLogo";
import { Card, CardSubLabel } from "@/components/ui";
import { PrimaryLineGraph } from "./ElectionDetailCharts";
import { buildCandidateColorMap } from "@/lib/campaigns/candidateColor";
import type { CandidateDetail, PartyGroup, SnapshotPoint } from "./ElectionDetailTypes";

function RemoveCandidateButton({
  candidateId,
  electionId,
  onRemoveSuccess,
}: {
  candidateId: string;
  electionId: string;
  onRemoveSuccess: () => void;
}) {
  const [removing, setRemoving] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (!confirm("Remove this candidate from the race?")) return;
        setRemoving(true);
        try {
          const res = await fetch(`/api/admin/elections/${electionId}/remove-candidate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ candidateId }),
          });
          const data = await res.json();
          if (res.ok) onRemoveSuccess();
          else alert(data.error ?? "Failed to remove");
        } catch {
          alert("Network error");
        } finally {
          setRemoving(false);
        }
      }}
      disabled={removing}
      className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-50"
      title="Remove candidate (admin)"
    >
      {removing ? "…" : "Remove"}
    </button>
  );
}

function PresidentialPrimaryDelegateRace({ group }: { group: PartyGroup }) {
  const colorMap = buildCandidateColorMap(
    group.candidates.map((candidate) => ({
      candidateId: candidate.id,
      campaignColor: candidate.campaignColor ?? null,
    })),
    group.partyId,
    group.partyColor
  );
  const candidates = group.candidates.map((candidate) => ({
    candidate,
    color: colorMap[candidate.id] ?? group.partyColor,
    pct: Math.max(0, Math.min(100, candidate.sharePct ?? 0)),
  }));
  const hasProjectedData = candidates.some(({ pct }) => pct > 0);

  return (
    <div className="px-4 sm:px-5 pb-4 pt-1 border-t border-card-border">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-xs text-muted/70 uppercase tracking-wide font-medium">
          Projected Delegate Race
        </div>
        <span className="text-[11px] text-muted">
          Awarded delegates locked, remaining states projected
        </span>
      </div>
      {hasProjectedData ? (
        <>
          <div className="h-3 overflow-hidden rounded-full border border-card-border bg-card-muted flex">
            {candidates.map(({ candidate, color, pct }) =>
              pct > 0 ? (
                <div
                  key={candidate.id}
                  className="h-full flex items-center justify-center"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                  title={`${candidate.characterName}: ${pct.toFixed(1)}% projected delegate share`}
                >
                  {pct >= 18 && (
                    <span className="text-[10px] font-semibold text-white/95 tabular-nums drop-shadow">
                      {pct.toFixed(1)}%
                    </span>
                  )}
                </div>
              ) : null
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {candidates.map(({ candidate, color, pct }) => (
              <span key={candidate.id} className="flex items-center gap-1.5 text-xs">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0 ring-1 ring-black/20"
                  style={{ backgroundColor: color }}
                />
                <span className="text-foreground font-medium">{candidate.characterName}</span>
                <span className="tabular-nums text-muted">{pct.toFixed(1)}%</span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center h-24 text-xs text-muted/50 italic">
          Delegate projection appears once candidates have live primary share data
        </div>
      )}
    </div>
  );
}

/**
 * Endorsement chips for a candidate. Lives here because both the primary
 * candidate rows and the general-phase tables show the same list. Previously
 * this markup was trapped inside `CandidateCard`, a component nothing
 * imported — so endorsements never rendered during the primary at all.
 */
export function EndorsementBadges({
  endorsements,
}: {
  endorsements: CandidateDetail["endorsements"];
}) {
  if (endorsements.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {endorsements.map((e, i) => {
        const label = e.type === "npp" ? e.nppName : e.characterName;
        const href =
          e.type === "npp"
            ? `/politicians/npp/${e.nppId}`
            : e.characterId
              ? `/character/${e.characterId}`
              : null;
        const tone =
          e.type === "npp"
            ? "text-yellow-400 hover:text-yellow-300"
            : "text-blue-400 hover:text-blue-300";
        const inner = (
          <>
            <svg className="h-2.5 w-2.5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            {label}
          </>
        );
        const cls = `flex items-center gap-0.5 text-[10px] transition-colors ${tone}`;
        return href ? (
          <Link key={`${label}-${i}`} href={href} className={cls} title={`Endorsed by ${label}`}>
            {inner}
          </Link>
        ) : (
          <span key={`${label}-${i}`} className={cls} title={`Endorsed by ${label}`}>
            {inner}
          </span>
        );
      })}
    </div>
  );
}

export function PartySection({
  group,
  inPrimary,
  snapshots,
  isAdmin,
  electionId,
  isEnded,
  onRemoveSuccess,
  isPresident,
  advancingCount = 1,
}: {
  group: PartyGroup;
  inPrimary: boolean;
  snapshots: SnapshotPoint[];
  isAdmin?: boolean;
  electionId?: string;
  isEnded?: boolean;
  onRemoveSuccess?: () => void;
  isPresident?: boolean;
  advancingCount?: number;
}) {
  const isUncontested = inPrimary && group.candidates.length === 1;
  const isGuaranteedAdvance = inPrimary && group.candidates.length <= advancingCount;
  const candidateColorMap = buildCandidateColorMap(
    group.candidates.map((candidate) => ({
      candidateId: candidate.id,
      campaignColor: candidate.campaignColor ?? null,
    })),
    group.partyId,
    group.partyColor
  );
  // Use absolute percentage for bars unless uncontested

  const header = (
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <PartyLogo
        partyId={group.partyId}
        partyColor={group.partyColor}
        countryId={group.countryId}
        size="h-4 w-4"
      />
      <span className="truncate font-semibold">{group.partyName}</span>
      <span className="hidden shrink-0 text-xs font-normal text-muted sm:inline">
        Econ {group.partyEcon >= 0 ? "+" : ""}
        {group.partyEcon} · Social {group.partySocial >= 0 ? "+" : ""}
        {group.partySocial}
      </span>
    </div>
  );

  return (
    <Card
      title={header}
      accentColor={group.partyColor}
      padding="none"
      action={
        isGuaranteedAdvance ? (
          <span className="text-xs italic text-muted">
            {isUncontested ? "Uncontested" : "All Advance"}
          </span>
        ) : undefined
      }
    >
      <div className="px-4 py-3 sm:px-5">
        {group.candidates.length === 0 ? (
          <div className="text-sm text-muted italic py-1">No candidates declared</div>
        ) : (
          <div className="space-y-3">
            {group.candidates.map((c, i) => {
              const isAdvancing = i < advancingCount;
              const rawPct = isUncontested ? 100 : (c.sharePct ?? 0);
              // Bar width is absolute percentage (0-100%)
              const barPct = isUncontested ? 100 : Math.max(0, Math.min(100, rawPct));
              const href = c.isNPP ? `/politicians/npp/${c.nppId}` : `/character/${c.characterId}`;
              const candidateColor = candidateColorMap[c.id] ?? group.partyColor;

              return (
                <div key={c.id}>
                  {/* Name row */}
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Avatar url={c.avatarUrl} name={c.characterName} size="h-5 w-5" />
                      <Link
                        href={href}
                        className={`font-semibold truncate hover:text-primary transition-colors ${
                          isAdvancing ? "text-foreground" : "text-muted"
                        }`}
                      >
                        {c.characterName}
                      </Link>
                      {c.isYou && (
                        <span className="rounded-full bg-primary/20 border border-primary/40 px-1.5 py-0.5 text-[10px] text-primary shrink-0">
                          You
                        </span>
                      )}
                      {c.isNPP && (
                        <span className="rounded-full bg-purple-500/20 border border-purple-500/40 px-1.5 py-0.5 text-[10px] text-purple-400 shrink-0">
                          NPP
                        </span>
                      )}
                      {c.travelState && (
                        <span
                          className="ml-2 text-xs text-muted/60 font-normal"
                          title={`Currently campaigning in ${c.travelState}`}
                        >
                          📍 {c.travelState}
                        </span>
                      )}
                      {isUncontested && (
                        <span className="text-[10px] text-muted italic shrink-0">Uncontested</span>
                      )}
                      {isAdvancing && !isUncontested && inPrimary && (
                        <span className="rounded-full bg-green-500/20 border border-green-500/40 px-1.5 py-0.5 text-[10px] text-green-400 shrink-0 font-medium">
                          {isGuaranteedAdvance ? "Advancing" : "Projected to Advance"}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {inPrimary && (
                        <span
                          className={`tabular-nums text-sm ${isAdvancing ? "font-bold" : "font-medium text-muted"}`}
                          style={isAdvancing ? { color: candidateColor } : undefined}
                        >
                          {rawPct.toFixed(1)}%
                        </span>
                      )}
                      {isAdmin && !isEnded && electionId && onRemoveSuccess && (
                        <RemoveCandidateButton
                          candidateId={c.id}
                          electionId={electionId}
                          onRemoveSuccess={onRemoveSuccess}
                        />
                      )}
                    </div>
                  </div>

                  {/* Vote bar */}
                  {inPrimary && (
                    <div className="h-1.5 rounded-full bg-card-border overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${barPct}%`,
                          backgroundColor: candidateColor,
                          opacity: isAdvancing ? 1 : 0.5,
                        }}
                      />
                    </div>
                  )}

                  <EndorsementBadges endorsements={c.endorsements} />
                </div>
              );
            })}
          </div>
        )}

        {isPresident && group.candidates.length > 0 && (
          <div className="text-[11px] text-muted mt-2">
            {group.candidates.length} candidates · Running mates shown on hover
          </div>
        )}
      </div>

      {/* Presidential primaries use delegate-share display, not the score-share history graph. */}
      {isPresident && inPrimary && group.candidates.length > 0 && (
        <PresidentialPrimaryDelegateRace group={group} />
      )}

      {/* Primary trend graph */}
      {!isPresident && group.hasCompetitivePrimary && inPrimary && snapshots.length >= 2 && (
        <div className="px-4 sm:px-5 pb-4 pt-1 border-t border-card-border">
          <CardSubLabel>Primary Trend</CardSubLabel>
          <PrimaryLineGraph
            snapshots={snapshots}
            partyId={group.partyId}
            candidates={group.candidates}
            countryId={group.countryId}
          />
        </div>
      )}
    </Card>
  );
}

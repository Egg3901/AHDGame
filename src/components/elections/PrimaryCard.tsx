"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { PartyLogo } from "@/components/PartyLogo";
import type { CountryId } from "@/lib/constants/countries";

interface PrimaryCandidate {
  id: string;
  name: string;
  avatarUrl?: string;
  characterId?: string;
  nppId?: string | null;
  isNPP?: boolean;
  percentage: number;
  isLeader: boolean;
}

interface PrimaryCardProps {
  partyId: string;
  partyName: string;
  partyColor: string;
  countryId?: CountryId | null;
  candidates: PrimaryCandidate[];
  isUncontested: boolean;
}

export function PrimaryCard({
  partyId,
  partyName,
  partyColor,
  countryId,
  candidates,
  isUncontested,
}: PrimaryCardProps) {
  const voteTotal = candidates.reduce((sum, c) => sum + c.percentage, 0) || 1;

  return (
    <div
      className="rounded-lg border border-card-border bg-card overflow-hidden"
      style={{ borderLeftWidth: 3, borderLeftColor: partyColor }}
    >
      {/* Party Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-card-border/60 bg-card-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <PartyLogo
            partyId={partyId}
            partyColor={partyColor}
            countryId={countryId}
            size="h-4 w-4"
          />
          <span className="text-xs font-semibold truncate" style={{ color: partyColor }}>
            {partyName}
          </span>
        </div>
        {isUncontested && (
          <span className="text-[10px] text-muted italic shrink-0">Uncontested</span>
        )}
      </div>

      {/* Candidate List with Bars */}
      <div className="px-3 py-2 space-y-2">
        {candidates.map((candidate, index) => {
          const href = candidate.isNPP
            ? `/politicians/npp/${candidate.nppId}`
            : candidate.characterId
              ? `/character/${candidate.characterId}`
              : null;
          const barWidth = isUncontested ? 100 : (candidate.percentage / voteTotal) * 100;

          return (
            <div key={candidate.id} className="space-y-1">
              {/* Candidate Row */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Avatar url={candidate.avatarUrl} name={candidate.name} size="h-6 w-6" />
                  {href ? (
                    <Link
                      href={href}
                      className="text-sm font-medium truncate hover:text-primary transition-colors"
                    >
                      {candidate.name}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium truncate">{candidate.name}</span>
                  )}
                  {candidate.isNPP && (
                    <span className="rounded-full bg-purple-500/20 border border-purple-500/40 px-1.5 py-0.5 text-[9px] text-purple-400 shrink-0">
                      NPP
                    </span>
                  )}
                </div>
                <span
                  className={`tabular-nums text-xs shrink-0 ${
                    candidate.isLeader && !isUncontested ? "font-bold" : "font-medium text-muted"
                  }`}
                  style={candidate.isLeader && !isUncontested ? { color: partyColor } : undefined}
                >
                  {candidate.percentage.toFixed(1)}%
                </span>
              </div>

              {/* Results Bar - Always shown, even for uncontested */}
              <div className="h-2 rounded-full bg-card-border overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.max(2, barWidth)}%`,
                    backgroundColor: partyColor,
                    opacity: index === 0 ? 1 : 0.6,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PrimaryCardGridProps {
  primaries: {
    partyId: string;
    partyName: string;
    partyColor: string;
    candidates: PrimaryCandidate[];
    isUncontested: boolean;
  }[];
  countryId?: CountryId | null;
}

export function PrimaryCardGrid({ primaries, countryId }: PrimaryCardGridProps) {
  if (primaries.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {primaries.map((primary) => (
        <PrimaryCard
          key={primary.partyId}
          partyId={primary.partyId}
          partyName={primary.partyName}
          partyColor={primary.partyColor}
          countryId={countryId}
          candidates={primary.candidates}
          isUncontested={primary.isUncontested}
        />
      ))}
    </div>
  );
}

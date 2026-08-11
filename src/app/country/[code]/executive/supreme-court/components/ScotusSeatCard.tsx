"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { getJusticePortrait, DEFAULT_JUSTICE_AVATAR } from "@/lib/scotus/justiceImages";

export interface SeatCardData {
  seatNumber: number;
  vacant: boolean;
  justiceName: string | null;
  justiceParty: string | null;
  justiceMode: "character" | "npp" | "historical" | null;
  economicLean: number | null;
  socialLean: number | null;
  isDivergent: boolean;
}

/** [-5, +5] lean scale (shared by characters/parties/justices) → a 0-100% bar position. */
function leanToPercent(lean: number): number {
  return ((Math.max(-5, Math.min(5, lean)) + 5) / 10) * 100;
}

function LeanBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <div className="relative h-1.5 flex-1 rounded-full bg-card-elevated">
        {value != null && (
          <span
            className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 -translate-x-1/2 rounded-full bg-primary ring-2 ring-card"
            style={{ left: `${leanToPercent(value)}%` }}
          />
        )}
      </div>
      <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted">
        {value != null ? value.toFixed(1) : "-"}
      </span>
    </div>
  );
}

/** Circular justice portrait. Uses a mapped public-domain portrait when one
 *  exists, otherwise the inline default motif; falls back to the default on a
 *  load error so a broken external image never leaves an empty frame. */
function JusticePortrait({ name }: { name: string | null }) {
  const mapped = getJusticePortrait(name);
  const [src, setSrc] = useState(mapped ?? DEFAULT_JUSTICE_AVATAR);
  const isDefault = src === DEFAULT_JUSTICE_AVATAR;
  return (
    <div
      className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-card-border ${
        isDefault
          ? "flex items-center justify-center bg-card-elevated text-muted"
          : "bg-card-elevated"
      }`}
    >
      {isDefault ? (
        // eslint-disable-next-line @next/next/no-img-element -- inline SVG data URI, next/image optimization does not apply
        <img src={DEFAULT_JUSTICE_AVATAR} alt="" aria-hidden className="h-7 w-7" />
      ) : (
        <Image
          src={src}
          alt=""
          fill
          unoptimized
          sizes="48px"
          className="object-cover"
          onError={() => setSrc(DEFAULT_JUSTICE_AVATAR)}
        />
      )}
    </div>
  );
}

/**
 * One Court seat (#3605). Vacant seats surface a Nominate CTA to the
 * president; occupied seats show the justice's name/party and both ideology
 * leans (economic/social, [-5, +5]) per #3581 story 26/29 — the read model a
 * president consults before nominating and any player can browse.
 */
export function ScotusSeatCard({
  seat,
  partyName,
  partyColor,
  canNominate,
  onNominate,
}: {
  seat: SeatCardData;
  partyName: string | null;
  partyColor: string | null;
  canNominate: boolean;
  onNominate: () => void;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Seat #{seat.seatNumber}
        </span>
        {seat.isDivergent && (
          <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
            Divergent
          </span>
        )}
      </div>

      {seat.vacant ? (
        <div className="mt-3">
          <p className="text-sm italic text-muted">Vacant</p>
          {canNominate && (
            <Button variant="secondary" onClick={onNominate} className="mt-3">
              Nominate
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex items-start gap-3">
            <JusticePortrait name={seat.justiceName} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{seat.justiceName}</p>
              {partyName && partyColor && (
                <div className="mt-1">
                  <PartyChip
                    partyName={partyName}
                    partyColor={partyColor}
                    partyId={seat.justiceParty}
                  />
                </div>
              )}
              {seat.justiceMode === "historical" && (
                <p className="mt-1 text-[10px] italic text-muted">Original Roster</p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <LeanBar label="Econ" value={seat.economicLean} />
            <LeanBar label="Social" value={seat.socialLean} />
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { PartyChip } from "@/app/congress/components/CongressShared";
import type { CountryId } from "@/lib/constants/countries";
import type { InstitutionIdentity } from "@/lib/constants/institutionIdentity";
import { hexToRgba } from "@/components/national/identityColor";

const SERIF_CJK = "'Noto Serif SC', 'Noto Serif JP', 'Songti SC', serif";
const SERIF_MONO = "'Playfair Display', Georgia, 'Times New Roman', serif";

export interface OfficePlaque {
  /** Office title in constitutional order (e.g. "President", "Premier"). */
  title: string;
  /** Seal-chip glyph for the office (e.g. "P", "VP", 主, 总). */
  sealGlyph: string;
  holder: {
    name: string;
    href?: string;
    avatarUrl?: string;
    partyId?: string;
    partyName?: string;
    partyColor?: string;
  } | null;
  /** Succession-rule copy shown in the vacancy state. */
  vacancyNote?: string;
  /** Mono footer line (tenure, mandate). */
  tenureLine?: string;
}

/**
 * B office plaques (locked composite): offices in constitutional order, seal
 * chip from the institution identity, party chip from party docs, dashed
 * vacancy treatment carrying the office's succession rule.
 */
export function OfficePlaques({
  countryId,
  identity,
  plaques,
  gridClassName = "grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3",
}: {
  countryId: CountryId;
  identity: InstitutionIdentity;
  plaques: OfficePlaque[];
  /** Override for narrow containers (e.g. a half-width hub column). */
  gridClassName?: string;
}) {
  const serif = identity.serif === "cjk" ? SERIF_CJK : SERIF_MONO;
  return (
    <div className={gridClassName}>
      {plaques.map((plaque) => {
        const vacant = plaque.holder === null;
        return (
          <div
            key={plaque.title}
            className={`relative overflow-hidden rounded-xl border p-4.5 p-5 ${
              vacant
                ? "border-dashed border-card-border bg-card-muted"
                : "border-card-border bg-card"
            }`}
          >
            <span
              aria-hidden
              className={`absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border text-[11px] ${
                vacant ? "border-dashed border-card-border text-muted/60" : ""
              }`}
              style={
                vacant
                  ? undefined
                  : {
                      borderColor: hexToRgba(identity.accentSoft, 0.35),
                      color: hexToRgba(identity.accentSoft, 0.6),
                      fontFamily: serif,
                    }
              }
            >
              {plaque.sealGlyph}
            </span>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              {plaque.title}
            </div>
            <div className="mt-2.5 flex items-center gap-2.5">
              {plaque.holder ? (
                <>
                  <Avatar
                    url={plaque.holder.avatarUrl}
                    name={plaque.holder.name}
                    size="h-11 w-11"
                    className="rounded-xl"
                  />
                  <div className="min-w-0">
                    {plaque.holder.href ? (
                      <Link
                        href={plaque.holder.href}
                        className="block truncate text-sm font-bold text-foreground transition-colors hover:text-primary"
                      >
                        {plaque.holder.name}
                      </Link>
                    ) : (
                      <span className="block truncate text-sm font-bold">{plaque.holder.name}</span>
                    )}
                    {plaque.holder.partyName && (
                      <div className="mt-1">
                        <PartyChip
                          partyName={plaque.holder.partyName}
                          partyColor={plaque.holder.partyColor ?? "#888888"}
                          partyId={plaque.holder.partyId ?? "independent"}
                          countryId={countryId}
                        />
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-dashed border-card-border bg-card-muted text-muted">
                    —
                  </span>
                  <div className="min-w-0">
                    <span className="block text-sm font-semibold italic text-muted">Vacant</span>
                    {plaque.vacancyNote && (
                      <p className="mt-0.5 text-[11px] leading-snug text-muted/80">
                        {plaque.vacancyNote}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
            {plaque.tenureLine && (
              <div className="mt-3 border-t border-card-border/50 pt-2 font-mono text-[10px] text-muted/70">
                {plaque.tenureLine}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

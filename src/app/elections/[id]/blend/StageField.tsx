"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { PartyLogo } from "@/components/PartyLogo";
import { BLEND, FONT } from "@/components/blend/tokens";
import type { CountryId } from "@/lib/constants/countries";
import type { CandidateDetail } from "../components/ElectionDetailTypes";

export interface StageFieldRow {
  id: string;
  name: string;
  /** Profile page: the character, or the NPP for a non-player politician. */
  href: string | null;
  avatarUrl: string | null;
  partyName: string;
  partyId: string | null;
  partyHref: string | null;
  color: string;
  /** The headline figure on the right: share, electoral votes, delegates. */
  figure: ReactNode;
  /** A smaller line under the figure. */
  sub?: ReactNode;
  campaignHref: string | null;
  isYou?: boolean;
  isWinner?: boolean;
}

/** Profile, party and campaign links for a candidate, from the race payload. */
export function candidateLinks(
  c: CandidateDetail | undefined,
  countryId: string
): Pick<StageFieldRow, "href" | "avatarUrl" | "partyId" | "partyHref" | "campaignHref"> {
  if (!c)
    return { href: null, avatarUrl: null, partyId: null, partyHref: null, campaignHref: null };
  const country = countryId.toLowerCase();
  return {
    href: c.isNPP && c.nppId ? `/politicians/npp/${c.nppId}` : `/character/${c.characterId}`,
    avatarUrl: c.avatarUrl ?? null,
    partyId: c.party ?? null,
    partyHref: c.party ? `/country/${country}/parties/${c.party}` : null,
    campaignHref: c.campaignId ? `/campaign/${c.campaignId}` : null,
  };
}

const linkStyle = {
  color: "inherit",
  textDecoration: "none",
} as const;

/**
 * The stage's candidate list: portrait, name (to the profile), party logo and
 * name (to the party), the race figure, and a direct link to the campaign.
 * One component for every phase so the rail reads the same in primary season,
 * the general and the final result.
 */
export function StageField({
  rows,
  countryId,
  title,
}: {
  rows: StageFieldRow[];
  countryId: string;
  title?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      {title ? (
        <div
          style={{
            fontFamily: FONT.sans,
            fontSize: 12,
            fontWeight: 500,
            color: BLEND.muted,
            marginBottom: 4,
          }}
        >
          {title}
        </div>
      ) : null}
      {rows.map((r) => (
        <div
          key={r.id}
          style={{
            display: "grid",
            gridTemplateColumns: "36px minmax(0, 1fr) auto",
            alignItems: "center",
            gap: 10,
            padding: "9px 0",
            borderBottom: `1px solid ${BLEND.hairline}`,
          }}
        >
          <div style={{ position: "relative" }}>
            <Avatar url={r.avatarUrl} name={r.name} size="h-9 w-9" tintColor={r.color} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 14,
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              {r.href ? (
                <Link
                  href={r.href}
                  className="hover:underline"
                  style={{ ...linkStyle, overflowWrap: "anywhere" }}
                >
                  {r.name}
                </Link>
              ) : (
                <span style={{ overflowWrap: "anywhere" }}>{r.name}</span>
              )}
              {r.isWinner ? <span style={{ color: BLEND.gold }}>★</span> : null}
              {r.isYou ? (
                <span style={{ fontFamily: FONT.mono, fontSize: 10, color: BLEND.accentInk }}>
                  YOU
                </span>
              ) : null}
            </div>
            <div
              style={{
                marginTop: 3,
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: BLEND.mutedDim,
                minWidth: 0,
              }}
            >
              <PartyLogo
                partyId={r.partyId}
                partyColor={r.color}
                size="h-4 w-4"
                countryId={countryId as CountryId}
              />
              {r.partyHref ? (
                <Link
                  href={r.partyHref}
                  className="hover:underline"
                  style={{
                    ...linkStyle,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.partyName}
                </Link>
              ) : (
                <span
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {r.partyName}
                </span>
              )}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 14, fontWeight: 600, color: r.color }}>
              {r.figure}
            </div>
            {r.sub ? (
              <div style={{ fontFamily: FONT.mono, fontSize: 11, color: BLEND.mutedDim }}>
                {r.sub}
              </div>
            ) : null}
            {r.campaignHref ? (
              <Link
                href={r.campaignHref}
                className="hover:underline"
                style={{ ...linkStyle, fontSize: 11.5, color: BLEND.accentInk }}
              >
                Campaign
              </Link>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

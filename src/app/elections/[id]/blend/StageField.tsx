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
  /** A control under the figure, such as the endorse button. */
  action?: ReactNode;
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

/** Keep wrapping between words and ellipsize only an individual long word. */
function CandidateName({ name }: { name: string }) {
  return (
    <>
      {name.split(/(\s+)/u).map((part, index) =>
        /^\s+$/u.test(part) ? (
          part
        ) : (
          <span
            key={index}
            style={{
              display: "inline-block",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {part}
          </span>
        )
      )}
    </>
  );
}

function PartyMark({ row, countryId }: { row: StageFieldRow; countryId: string }) {
  const mark = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <PartyLogo
        partyId={row.partyId}
        partyColor={row.color}
        size="h-3 w-3"
        countryId={countryId as CountryId}
      />
      <span
        className="hidden lg:inline"
        style={{
          maxWidth: 100,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 11,
          fontWeight: 400,
          color: BLEND.mutedDim,
        }}
      >
        {row.partyName}
      </span>
    </span>
  );

  if (row.partyHref) {
    return (
      <Link
        href={row.partyHref}
        aria-label={row.partyName}
        title={row.partyName}
        style={{ ...linkStyle, flex: "0 0 auto", display: "inline-flex" }}
      >
        {mark}
      </Link>
    );
  }

  return (
    <span
      role="img"
      aria-label={row.partyName}
      title={row.partyName}
      style={{ flex: "0 0 auto", display: "inline-flex" }}
    >
      {mark}
    </span>
  );
}

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
          data-field-row={r.id}
          style={{
            display: "grid",
            gridTemplateColumns: "36px minmax(0, 1fr)",
            alignItems: "start",
            columnGap: 10,
            rowGap: 3,
            padding: "9px 0",
            borderBottom: `1px solid ${BLEND.hairline}`,
            minWidth: 0,
          }}
        >
          <div
            data-field-part="avatar"
            style={{ position: "relative", gridRow: "1 / span 3", marginTop: 1 }}
          >
            <Avatar url={r.avatarUrl} name={r.name} size="h-9 w-9" tintColor={r.color} />
          </div>
          <div
            data-field-part="identity"
            style={{
              gridColumn: 2,
              minWidth: 0,
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <div
              style={{
                minWidth: 0,
                flex: "1 1 0%",
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
                fontSize: 14,
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              <div
                data-field-part="name-column"
                className="min-w-0 flex-1"
                style={{ minWidth: 0, flex: "1 1 0%" }}
              >
                {r.href ? (
                  <Link
                    href={r.href}
                    className="hover:underline"
                    style={{ ...linkStyle, display: "block" }}
                  >
                    <CandidateName name={r.name} />
                  </Link>
                ) : (
                  <span style={{ display: "block" }}>
                    <CandidateName name={r.name} />
                  </span>
                )}
              </div>
              {r.partyName ? <PartyMark row={r} countryId={countryId} /> : null}
              {r.isWinner ? <span style={{ color: BLEND.gold, flex: "0 0 auto" }}>★</span> : null}
              {r.isYou ? (
                <span
                  style={{
                    fontFamily: FONT.mono,
                    fontSize: 10,
                    color: BLEND.accentInk,
                    flex: "0 0 auto",
                  }}
                >
                  YOU
                </span>
              ) : null}
            </div>
            <div data-field-part="figure" style={{ flex: "0 0 auto", textAlign: "right" }}>
              <div style={{ fontFamily: FONT.mono, fontSize: 14, fontWeight: 600, color: r.color }}>
                {r.figure}
              </div>
            </div>
          </div>
          <div
            data-field-part="subline"
            style={{
              gridColumn: 2,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {r.sub ? (
              <span style={{ fontFamily: FONT.mono, fontSize: 11, color: BLEND.mutedDim }}>
                {r.sub}
              </span>
            ) : null}
            {r.campaignHref ? (
              <Link
                href={r.campaignHref}
                className="hover:underline"
                style={{ ...linkStyle, fontSize: 11.5, color: BLEND.accentInk, flexShrink: 0 }}
              >
                Campaign
              </Link>
            ) : null}
          </div>
          {r.action ? (
            <div
              data-field-part="action"
              style={{ gridColumn: 2, minWidth: 0, textAlign: "right" }}
            >
              {r.action}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

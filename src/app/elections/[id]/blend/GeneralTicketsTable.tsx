"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { BLEND, FONT, OPS_LEVER_COLOR } from "@/components/blend/tokens";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { totalCampaignLevels, type CampaignSummary } from "../components/useElectionCampaigns";
import type { GeneralTicketVM } from "./generalBlendViewModel";

/**
 * The presidential general screen's tickets: standing and campaign operations
 * in one place.
 *
 * These were two surfaces for the same people. "The tickets" carried the
 * projected electoral votes, share and popular vote; "Campaign operations", a
 * separate panel further down, carried the manager, funds, actions and levels
 * and the link into the campaign. A reader comparing two tickets had to hold
 * one list in their head while reading the other. Each ticket is now one row
 * (desktop) or one card (phone) carrying both.
 *
 * Campaigns arrive from a separate endpoint and are joined on
 * `GeneralTicketVM.candidateKey`. A ticket without a campaign, or one still
 * loading, shows a placeholder in those cells rather than dropping the row.
 */

export interface GeneralTicketsProps {
  tickets: GeneralTicketVM[];
  campaigns: CampaignSummary[];
  campaignsLoading: boolean;
  /** The endorse control from the view, which owns the busy and error state. */
  endorseButton: (ticket: GeneralTicketVM) => ReactNode;
}

const NAME_LINK: CSSProperties = {
  color: "inherit",
  textDecoration: "underline",
  textDecorationColor: "rgba(255,255,255,.25)",
  textUnderlineOffset: 3,
};

const PLACEHOLDER = "-";

function campaignFor(
  ticket: GeneralTicketVM,
  campaigns: CampaignSummary[]
): CampaignSummary | undefined {
  return campaigns.find((c) => (c.candidateRefId ?? c.candidateId) === ticket.candidateKey);
}

/** What goes in a campaign cell when there is no campaign figure to show. */
function missing(loading: boolean) {
  return <span style={{ color: BLEND.mutedDimmer }}>{loading ? "…" : PLACEHOLDER}</span>;
}

function campaignFigures(
  campaign: CampaignSummary | undefined,
  loading: boolean
): { funds: ReactNode; actions: ReactNode; levels: ReactNode } {
  if (!campaign) {
    const none = missing(loading);
    return { funds: none, actions: none, levels: none };
  }
  return {
    funds: (
      <span style={{ color: OPS_LEVER_COLOR.fundraising }}>
        {formatCurrencyFaceAmount(campaign.funds ?? 0, campaign.currencyCode)}
      </span>
    ),
    actions: campaign.actions ?? 0,
    levels: totalCampaignLevels(campaign),
  };
}

function YouChip() {
  return (
    <span
      style={{
        flexShrink: 0,
        padding: "1px 6px",
        border: "1px solid rgba(220,38,38,.4)",
        background: "rgba(220,38,38,.12)",
        color: BLEND.accentInk,
        fontFamily: FONT.mono,
        fontSize: 9,
        letterSpacing: ".1em",
        textTransform: "uppercase",
        borderRadius: 99,
      }}
    >
      You
    </span>
  );
}

function PartyLine({ ticket, size }: { ticket: GeneralTicketVM; size: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
        fontFamily: FONT.sans,
        fontSize: size,
        color: BLEND.muted,
      }}
    >
      <i
        style={{
          width: 8,
          height: 8,
          borderRadius: 99,
          background: ticket.color,
          display: "block",
          flexShrink: 0,
        }}
      />
      <Link href={ticket.partyHref} style={NAME_LINK}>
        {ticket.party}
      </Link>
    </span>
  );
}

/** Running mate and campaign manager, one line each, whichever exist. */
function MateAndManager({
  ticket,
  campaign,
  size,
}: {
  ticket: GeneralTicketVM;
  campaign: CampaignSummary | undefined;
  size: number;
}) {
  const manager = campaign?.managerName;
  if (!ticket.mate && !manager)
    return <span style={{ color: BLEND.mutedDimmer }}>{PLACEHOLDER}</span>;
  return (
    <>
      {ticket.mate ? <div>with {ticket.mate}</div> : null}
      {manager ? (
        <div style={{ color: BLEND.mutedDim, fontSize: size }}>Manager: {manager}</div>
      ) : null}
    </>
  );
}

function ViewCampaign({ campaign }: { campaign: CampaignSummary }) {
  return (
    <Link
      href={`/campaign/${campaign.id}`}
      style={{
        display: "block",
        padding: "4px 10px",
        background: BLEND.accent,
        textAlign: "center",
        whiteSpace: "nowrap",
        fontFamily: FONT.sans,
        fontSize: 12,
        fontWeight: 700,
        color: "#fff",
      }}
    >
      View campaign
    </Link>
  );
}

function FogNote({ campaigns }: { campaigns: CampaignSummary[] }) {
  if (campaigns.length === 0 || campaigns.some((c) => c.isExact)) return null;
  return (
    <div style={{ marginTop: 12, fontFamily: FONT.sans, fontSize: 12, color: BLEND.mutedDim }}>
      Campaign levels are approximate (fog of war)
    </div>
  );
}

const TH: CSSProperties = {
  padding: "0 8px 8px",
  textAlign: "right",
  fontFamily: FONT.mono,
  fontSize: 9.5,
  fontWeight: 400,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: BLEND.mutedDim,
  borderBottom: `1px solid ${BLEND.hairlineStrong}`,
  whiteSpace: "nowrap",
};

const TD: CSSProperties = {
  padding: "12px 8px",
  textAlign: "right",
  verticalAlign: "middle",
  borderBottom: "1px solid rgba(42,42,61,.6)",
  fontFamily: FONT.mono,
  fontSize: 13,
  whiteSpace: "nowrap",
};

/** Desktop: one dense row per ticket. */
export function TicketsTable({
  tickets,
  campaigns,
  campaignsLoading,
  endorseButton,
}: GeneralTicketsProps) {
  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th scope="col" style={{ ...TH, textAlign: "left" }}>
                Ticket
              </th>
              <th scope="col" style={{ ...TH, textAlign: "left" }}>
                Mate and manager
              </th>
              <th scope="col" style={TH} title="Projected electoral votes">
                Proj. EV
              </th>
              <th scope="col" style={TH}>
                Share
              </th>
              <th scope="col" style={TH}>
                Votes
              </th>
              <th scope="col" style={TH}>
                Funds
              </th>
              <th scope="col" style={TH}>
                Actions
              </th>
              <th scope="col" style={TH}>
                Levels
              </th>
              <th scope="col" style={TH}>
                <span className="sr-only">Endorse and campaign</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((c) => {
              const campaign = campaignFor(c, campaigns);
              const figures = campaignFigures(campaign, campaignsLoading);
              return (
                <tr key={c.id} style={c.isYou ? { background: "rgba(220,38,38,.04)" } : undefined}>
                  <td style={{ ...TD, textAlign: "left", whiteSpace: "normal", minWidth: 190 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar url={c.avatarUrl} name={c.name} size="h-9 w-9" />
                      <span style={{ minWidth: 0 }}>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontFamily: FONT.sans,
                            fontSize: 15,
                            fontWeight: 600,
                          }}
                        >
                          <Link href={c.href} style={NAME_LINK}>
                            {c.name}
                          </Link>
                          {c.isYou ? <YouChip /> : null}
                        </span>
                        <span style={{ display: "block", marginTop: 1 }}>
                          <PartyLine ticket={c} size={12.5} />
                        </span>
                      </span>
                    </span>
                  </td>
                  <td
                    style={{
                      ...TD,
                      textAlign: "left",
                      whiteSpace: "normal",
                      fontFamily: FONT.sans,
                      fontSize: 12.5,
                      color: BLEND.muted,
                    }}
                  >
                    <MateAndManager ticket={c} campaign={campaign} size={12} />
                  </td>
                  <td style={{ ...TD, fontSize: 17, color: c.color }}>{c.ev}</td>
                  <td style={TD}>{c.pct}%</td>
                  <td style={{ ...TD, fontSize: 12.5, color: BLEND.muted }}>{c.votes}</td>
                  <td style={TD}>{figures.funds}</td>
                  <td style={TD}>{figures.actions}</td>
                  <td style={TD}>{figures.levels}</td>
                  <td style={{ ...TD, width: 1 }}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {endorseButton(c)}
                      {campaign ? <ViewCampaign campaign={campaign} /> : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <FogNote campaigns={campaigns} />
    </>
  );
}

/** One label over one figure, in the card's figure grid. */
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontFamily: FONT.mono,
          fontSize: 9,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: BLEND.mutedDim,
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 2,
          fontFamily: FONT.mono,
          fontSize: 13,
          overflowWrap: "anywhere",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Phone: one compact card per ticket, the same fields as the desktop row. */
export function TicketCards({
  tickets,
  campaigns,
  campaignsLoading,
  endorseButton,
}: GeneralTicketsProps) {
  return (
    <>
      {tickets.map((c) => {
        const campaign = campaignFor(c, campaigns);
        const figures = campaignFigures(campaign, campaignsLoading);
        const endorse = endorseButton(c);
        return (
          <article
            key={c.id}
            style={{
              padding: "12px 0",
              borderBottom: "1px solid rgba(42,42,61,.6)",
              ...(c.isYou ? { background: "rgba(220,38,38,.04)" } : {}),
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <Avatar url={c.avatarUrl} name={c.name} size="h-8 w-8" />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontFamily: FONT.sans,
                    fontSize: 16,
                    fontWeight: 600,
                  }}
                >
                  <Link href={c.href} style={NAME_LINK}>
                    {c.name}
                  </Link>
                  {c.isYou ? <YouChip /> : null}
                </span>
                <span style={{ display: "block", marginTop: 1 }}>
                  <PartyLine ticket={c} size={12.5} />
                </span>
              </span>
            </div>
            <div
              style={{
                marginTop: 6,
                fontFamily: FONT.sans,
                fontSize: 12.5,
                color: BLEND.muted,
              }}
            >
              <MateAndManager ticket={c} campaign={campaign} size={12} />
            </div>
            <div
              style={{
                marginTop: 10,
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                rowGap: 10,
                columnGap: 12,
              }}
            >
              <Figure label="Proj. EV">
                <span style={{ color: c.color }}>{c.ev}</span>
              </Figure>
              <Figure label="Share">{c.pct}%</Figure>
              <Figure label="Votes">{c.votes}</Figure>
              <Figure label="Funds">{figures.funds}</Figure>
              <Figure label="Actions">{figures.actions}</Figure>
              <Figure label="Levels">{figures.levels}</Figure>
            </div>
            {endorse || campaign ? (
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
                {endorse}
                {campaign ? <ViewCampaign campaign={campaign} /> : null}
              </div>
            ) : null}
          </article>
        );
      })}
      <FogNote campaigns={campaigns} />
    </>
  );
}

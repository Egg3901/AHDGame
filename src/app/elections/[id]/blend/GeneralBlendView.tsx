"use client";

import { apiErrorText } from "@/lib/errors/catalog";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { BLEND, FONT, BLEND_LABEL } from "@/components/blend/tokens";
import { BlendShell, BlendHeader, BlendSection } from "@/components/blend/BlendShell";
import { BlendRail, BlendChipRail } from "@/components/blend/BlendRail";
import { BlendTicker } from "@/components/blend/BlendTicker";
import { DemocraticHealthBlock } from "./DemocraticHealthBlock";
import {
  buildGeneralBlendViewModel,
  type GeneralRail,
  type GeneralTicketVM,
} from "./generalBlendViewModel";
import {
  EvBar,
  TileBoard,
  YourTicketBlock,
  NationalMoodBlock,
  WhyItMovedBlock,
  TierLegend,
  type GeneralBlendViewProps,
} from "./GeneralBlendParts";
export type { GeneralBlendViewProps } from "./GeneralBlendParts";

/** The Blend general-election screen (Proposal D). */
export function GeneralBlendView({ election, electionId, wire, onRefresh }: GeneralBlendViewProps) {
  const [rail, setRail] = useState<GeneralRail>("overview");
  const [busy, setBusy] = useState<string | null>(null);
  /** Why the last endorsement was refused, or null. */
  const [endorseError, setEndorseError] = useState<string | null>(null);

  const vm = useMemo(
    () => buildGeneralBlendViewModel({ election, wire, rail }),
    [election, wire, rail]
  );

  /**
   * The hero shows two tickets at a time. A third ticket (or more) pages
   * through instead of squeezing in: page two shows 3rd (and 4th), and so on.
   */
  const heroPages = Math.max(1, Math.ceil(vm.tickets.length / 2));
  const [heroPage, setHeroPage] = useState(0);
  const safeHeroPage = Math.min(Math.max(0, heroPage), heroPages - 1);
  const heroPairTickets = vm.tickets.slice(safeHeroPage * 2, safeHeroPage * 2 + 2);

  /** Turns left plus the local close time, under the masthead on both trees. */
  const closeLine = vm.closeSummary ? (
    <div
      style={{
        fontFamily: FONT.mono,
        fontSize: 10.5,
        letterSpacing: ".08em",
        color: BLEND.muted,
      }}
    >
      {vm.closeSummary.toUpperCase()}
    </div>
  ) : null;

  /** Pager for the hero pair, drawn only once a third ticket exists. */
  const heroPager =
    heroPages > 1 ? (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 10,
            letterSpacing: ".1em",
            color: BLEND.mutedDim,
          }}
        >
          {safeHeroPage * 2 + 1}-{Math.min(vm.tickets.length, safeHeroPage * 2 + 2)} OF{" "}
          {vm.tickets.length}
        </span>
        <span style={{ display: "inline-flex", gap: 8 }}>
          <button
            type="button"
            aria-label="Show previous tickets"
            disabled={safeHeroPage === 0}
            onClick={() => setHeroPage(safeHeroPage - 1)}
            style={{
              padding: "4px 12px",
              font: "inherit",
              fontFamily: FONT.mono,
              fontSize: 12,
              cursor: safeHeroPage === 0 ? "not-allowed" : "pointer",
              border: `1px solid ${BLEND.hairlineStrong}`,
              background: "transparent",
              color: safeHeroPage === 0 ? BLEND.mutedDimmer : BLEND.muted,
            }}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Show next tickets"
            disabled={safeHeroPage >= heroPages - 1}
            onClick={() => setHeroPage(safeHeroPage + 1)}
            style={{
              padding: "4px 12px",
              font: "inherit",
              fontFamily: FONT.mono,
              fontSize: 12,
              cursor: safeHeroPage >= heroPages - 1 ? "not-allowed" : "pointer",
              border: `1px solid ${BLEND.hairlineStrong}`,
              background: "transparent",
              color: safeHeroPage >= heroPages - 1 ? BLEND.mutedDimmer : BLEND.muted,
            }}
          >
            ›
          </button>
        </span>
      </div>
    ) : null;

  /**
   * Endorse or un-endorse a ticket.
   *
   * A refusal used to be swallowed whole: the handler acted only on `res.ok`,
   * so a rejected endorsement left the button looking like it did nothing and
   * said nothing about why. The route has real reasons to say no — the race has
   * ended, the endorsement is already spent elsewhere — and the reader is
   * entitled to hear them.
   */
  async function toggleEndorse(candidateId: string, currentlyEndorsed: boolean) {
    setBusy(candidateId);
    setEndorseError(null);
    try {
      const res = await fetch(`/api/elections/${electionId}/endorse`, {
        method: currentlyEndorsed ? "DELETE" : "POST",
        ...(currentlyEndorsed
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ candidateId }),
            }),
      });
      if (res.ok) {
        onRefresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setEndorseError(apiErrorText(body, "That endorsement did not go through."));
    } catch {
      setEndorseError("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const campaignLink = vm.campaignHref ? (
    <Link
      href={vm.campaignHref}
      style={{
        marginTop: 14,
        display: "block",
        background: BLEND.accent,
        padding: 11,
        textAlign: "center",
        fontFamily: FONT.mono,
        fontSize: 10.5,
        letterSpacing: ".08em",
        fontWeight: 700,
        color: "#fff",
      }}
    >
      OPEN CAMPAIGN MANAGER
    </Link>
  ) : null;

  /**
   * The endorse control, shared by the hero and the tickets table.
   *
   * It used to exist only inside the table, which the mobile tree never
   * rendered, so a player on a phone could not endorse anybody. Defining it
   * once means the affordance cannot go missing from one layout again — and
   * that the self-endorsement guard cannot be applied to one and not the other.
   *
   * Nothing is rendered for the reader's own ticket. The route refuses it
   * ("You cannot endorse yourself", 400), so the button could never do anything
   * but fail; offering it was an affordance that had no action behind it.
   */
  const endorseButton = (c: GeneralTicketVM) => {
    if (c.isYou) return null;
    return (
      <button
        type="button"
        disabled={busy === c.id}
        onClick={() => toggleEndorse(c.id, c.endorsed)}
        style={{
          ...BLEND_LABEL,
          padding: "4px 10px",
          font: "inherit",
          fontWeight: 700,
          whiteSpace: "nowrap",
          cursor: busy === c.id ? "not-allowed" : "pointer",
          ...(c.endorsed
            ? {
                border: "1px solid rgba(34,197,94,.4)",
                background: "rgba(34,197,94,.12)",
                color: BLEND.positive,
              }
            : {
                border: `1px solid ${BLEND.hairlineStrong}`,
                background: "transparent",
                color: BLEND.muted,
              }),
        }}
      >
        {busy === c.id ? "…" : c.endorsed ? "Endorsed" : "Endorse"}
      </button>
    );
  };

  /** The small caps label that says which of the two figures follows. */
  const labelStyle = (fontSize: number): React.CSSProperties => ({
    fontFamily: FONT.mono,
    fontSize,
    letterSpacing: ".14em",
    textTransform: "uppercase",
    color: BLEND.mutedDim,
  });

  const heroCell = (
    c: GeneralTicketVM,
    i: number,
    row: string,
    style: React.CSSProperties,
    content: React.ReactNode
  ) => (
    <div
      key={`${c.id}-${row}`}
      style={{
        display: "flex",
        justifyContent: i === 0 ? "flex-start" : "flex-end",
        textAlign: i === 0 ? "left" : "right",
        // A grid item's default `min-width: auto` floors the track at its
        // widest word. On a phone each track is roughly 160px, and `body` is
        // `overflow-x: clip`, so a long name would push the other ticket off
        // a screen that cannot scroll sideways to reach it.
        minWidth: 0,
        ...style,
      }}
    >
      {content}
    </div>
  );

  /**
   * The two leading tickets, side by side, at a given type scale.
   *
   * Counted first, forecast second. The hero figure is the ballots the engine
   * has actually banked; the electoral votes under it are read off those same
   * ballots by winner-take-all and are a projection, because no state is
   * awarded until the race resolves — mid-race there is no such thing as an
   * electoral vote a ticket already holds. Leading with the electoral figure
   * unlabelled invited it to be read as won. Each half is named and the two
   * are ruled apart.
   *
   * One function for both trees. The phone used to draw its own inline copy of
   * this block, so a fix applied to one layout left the other as it was — and
   * both copies had the same latent fault, since each side was an independent
   * flex column. Any asymmetry between them (one ticket with a running mate,
   * the reader's own ticket with no endorse button) pushed one column down and
   * the figures stopped lining up. Shared grid rows align by construction,
   * whatever each side happens to carry.
   */
  const heroPair = (
    scale: {
      name: number;
      party: number;
      mate: number;
      label: number;
      votes: number;
      share: number;
      projection: number;
      columnGap: number;
      marginBottom: number;
      avatarSize: string;
    },
    pair: GeneralTicketVM[]
  ) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        columnGap: scale.columnGap,
        alignItems: "end",
        marginBottom: scale.marginBottom,
      }}
    >
      {pair.map((c, i) =>
        heroCell(
          c,
          i,
          "name",
          { fontFamily: FONT.sans, fontSize: scale.name, fontWeight: 600 },
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
              justifyContent: i === 0 ? "flex-start" : "flex-end",
            }}
          >
            <Avatar url={c.avatarUrl} name={c.name} size={scale.avatarSize} />
            <Link
              href={c.href}
              style={{
                color: "inherit",
                textDecoration: "underline",
                textDecorationColor: "rgba(255,255,255,.25)",
                textUnderlineOffset: 3,
              }}
            >
              {c.name}
            </Link>
          </span>
        )
      )}
      {pair.map((c, i) =>
        heroCell(
          c,
          i,
          "party",
          {
            marginTop: 2,
            fontFamily: FONT.mono,
            fontSize: scale.party,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            color: BLEND.mutedDim,
          },
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <i
              style={{
                width: 8,
                height: 8,
                borderRadius: 99,
                background: c.color,
                display: "block",
                flexShrink: 0,
              }}
            />
            <Link
              href={c.partyHref}
              style={{
                color: "inherit",
                textDecoration: "underline",
                textDecorationColor: "rgba(255,255,255,.25)",
                textUnderlineOffset: 3,
              }}
            >
              {c.party}
            </Link>
          </span>
        )
      )}
      {/* Rendered for both sides even when only one has a mate, so the row
          exists and the figures below it stay level. */}
      {pair.some((c) => c.mate)
        ? pair.map((c, i) =>
            heroCell(
              c,
              i,
              "mate",
              {
                marginTop: 2,
                fontFamily: FONT.sans,
                fontSize: scale.mate,
                color: BLEND.mutedDim,
                minHeight: 18,
              },
              c.mate ? `with ${c.mate}` : ""
            )
          )
        : null}
      {/* The counted half. These are ballots the engine has actually banked, so
          they carry the hero figure; the electoral votes below them are read
          off the same ballots and are a forecast until the race resolves. */}
      {pair.map((c, i) =>
        heroCell(c, i, "votes-label", { marginTop: 9, ...labelStyle(scale.label) }, "Votes banked")
      )}
      {pair.map((c, i) =>
        heroCell(
          c,
          i,
          "votes",
          {
            marginTop: 3,
            fontFamily: FONT.mono,
            fontSize: scale.votes,
            lineHeight: 1,
            fontWeight: 500,
            letterSpacing: "-0.04em",
            color: c.color,
          },
          c.votes
        )
      )}
      {pair.map((c, i) =>
        heroCell(
          c,
          i,
          "share",
          { marginTop: 4, fontFamily: FONT.mono, fontSize: scale.share, color: BLEND.muted },
          `${c.pct}%`
        )
      )}
      {/* The forecast half, ruled off so the two cannot be read as one figure. */}
      {pair.map((c, i) =>
        heroCell(
          c,
          i,
          "projection-label",
          {
            marginTop: 11,
            paddingTop: 8,
            borderTop: `1px solid ${BLEND.hairline}`,
            ...labelStyle(scale.label),
          },
          "Current projection"
        )
      )}
      {pair.map((c, i) =>
        heroCell(
          c,
          i,
          "projection",
          {
            marginTop: 3,
            fontFamily: FONT.mono,
            fontSize: scale.projection,
            lineHeight: 1,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            color: c.color,
          },
          `${c.ev} EV`
        )
      )}
      {pair.some((c) => !c.isYou)
        ? pair.map((c, i) => heroCell(c, i, "endorse", { marginTop: 10 }, endorseButton(c)))
        : null}
    </div>
  );

  const ticketRows = vm.tickets.map((c) => (
    <div
      key={c.id}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 70px 88px 96px 92px",
        gap: 16,
        alignItems: "baseline",
        padding: "14px 0",
        borderBottom: "1px solid rgba(42,42,61,.6)",
        ...(c.isYou ? { background: "rgba(220,38,38,.04)" } : {}),
      }}
    >
      <span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: FONT.sans,
            fontSize: 17,
            fontWeight: 600,
          }}
        >
          <Avatar url={c.avatarUrl} name={c.name} size="h-9 w-9" />
          <Link
            href={c.href}
            style={{
              color: "inherit",
              textDecoration: "underline",
              textDecorationColor: "rgba(255,255,255,.25)",
              textUnderlineOffset: 3,
            }}
          >
            {c.name}
          </Link>
        </span>
        <span
          style={{
            display: "block",
            marginTop: 1,
            fontFamily: FONT.sans,
            fontSize: 13,
            color: BLEND.muted,
          }}
        >
          {c.mate ? `with ${c.mate}` : c.party}
        </span>
      </span>
      <span style={{ textAlign: "right", fontFamily: FONT.mono, fontSize: 18, color: c.color }}>
        {c.ev}
      </span>
      <span style={{ textAlign: "right", fontFamily: FONT.mono, fontSize: 14 }}>{c.pct}%</span>
      <span
        style={{ textAlign: "right", fontFamily: FONT.mono, fontSize: 12.5, color: BLEND.muted }}
      >
        {c.votes}
      </span>
      <span style={{ display: "flex", justifyContent: "flex-end" }}>{endorseButton(c)}</span>
    </div>
  ));

  return (
    <>
      {/* Mobile */}
      <div className="lg:hidden" style={{ background: BLEND.page, color: BLEND.ink }}>
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 5,
            background: BLEND.rail,
            borderBottom: `1px solid ${BLEND.hairline}`,
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              paddingBottom: 9,
              borderBottom: `1px solid ${BLEND.hairline}`,
              fontFamily: FONT.sans,
              fontSize: 10,
              letterSpacing: ".2em",
              textTransform: "uppercase",
              color: BLEND.muted,
            }}
          >
            <span>{vm.kicker}</span>
            <span style={{ fontFamily: FONT.mono, letterSpacing: ".06em" }}>
              {vm.closesIn != null ? `${vm.closesIn} TURNS` : ""}
            </span>
          </div>
          <div
            style={{
              marginTop: 11,
              fontFamily: FONT.sans,
              fontSize: 24,
              lineHeight: 1.1,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            {vm.headline}
          </div>
          <BlendChipRail
            items={vm.railItems}
            selectedId={rail}
            onSelect={(id) => setRail(id as GeneralRail)}
            fontSize={11}
          />
        </div>

        <BlendTicker tag="CALLS" items={vm.wire} />

        <div style={{ padding: 16 }}>
          {closeLine ? <div style={{ marginBottom: 14 }}>{closeLine}</div> : null}
          {vm.showCollege && heroPairTickets.length > 0 ? (
            <div style={{ marginBottom: 22 }}>
              {heroPager}
              {heroPair(
                {
                  name: 15,
                  party: 9,
                  mate: 12,
                  label: 8,
                  votes: 34,
                  share: 11,
                  projection: 20,
                  columnGap: 16,
                  marginBottom: 0,
                  avatarSize: "h-8 w-8",
                },
                heroPairTickets
              )}
              <div style={{ marginTop: 14 }}>
                <EvBar vm={vm} height={28} error={endorseError} />
              </div>
            </div>
          ) : null}

          {/* The reader's own standing, above the board rather than below it and
              the tickets list. The desktop rail puts this top-right, so a phone
              burying it under 48 tiles was the odd one out. */}
          {vm.yourTicket ? (
            <div style={{ marginBottom: 22 }}>
              <h2
                style={{
                  margin: "0 0 4px",
                  fontFamily: FONT.sans,
                  fontSize: 20,
                  fontWeight: 600,
                }}
              >
                Your ticket
              </h2>
              <YourTicketBlock vm={vm} campaignLink={null} />
            </div>
          ) : null}

          {vm.showBoard && vm.tiles.length > 0 ? (
            <div style={{ marginBottom: 22 }}>
              <h2
                style={{
                  margin: "0 0 12px",
                  fontFamily: FONT.sans,
                  fontSize: 20,
                  fontWeight: 600,
                }}
              >
                The board
              </h2>
              <TileBoard vm={vm} columns={6} electionId={electionId} />
              <TierLegend vm={vm} />
            </div>
          ) : null}

          {vm.showTickets && vm.showTicketsTable ? (
            <div>
              <h2
                style={{ margin: "0 0 2px", fontFamily: FONT.sans, fontSize: 20, fontWeight: 600 }}
              >
                The tickets
              </h2>
              <p style={{ ...BLEND_LABEL, margin: "0 0 10px" }}>
                Projected electoral votes · vote share
              </p>
              {vm.tickets.map((c) => (
                <div
                  key={c.id}
                  style={{ padding: "12px 0", borderBottom: "1px solid rgba(42,42,61,.6)" }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        fontFamily: FONT.sans,
                        fontSize: 16,
                        fontWeight: 600,
                      }}
                    >
                      <Avatar url={c.avatarUrl} name={c.name} size="h-8 w-8" />
                      <Link
                        href={c.href}
                        style={{
                          color: "inherit",
                          textDecoration: "underline",
                          textDecorationColor: "rgba(255,255,255,.25)",
                          textUnderlineOffset: 3,
                        }}
                      >
                        {c.name}
                      </Link>
                    </span>
                    <span style={{ fontFamily: FONT.mono, fontSize: 16, color: c.color }}>
                      {c.ev}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: FONT.sans,
                        fontSize: 13,
                        color: BLEND.muted,
                      }}
                    >
                      {c.mate ? `with ${c.mate}` : c.party}
                    </span>
                    <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: BLEND.muted }}>
                      {c.pct}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Everything below lived only in the desktop rail, which is
              `hidden lg:block`. On a phone that meant a player could not see
              their own ticket's standing on their own election night, nor what
              had moved the vote. */}

          {vm.mood ? (
            <div style={{ marginTop: 24 }}>
              <h2
                style={{
                  margin: "0 0 4px",
                  fontFamily: FONT.sans,
                  fontSize: 20,
                  fontWeight: 600,
                }}
              >
                National mood
              </h2>
              <NationalMoodBlock vm={vm} />
            </div>
          ) : null}

          {election.democraticHealth ? (
            <div style={{ marginTop: 24 }}>
              <h2
                style={{
                  margin: "0 0 4px",
                  fontFamily: FONT.sans,
                  fontSize: 20,
                  fontWeight: 600,
                }}
              >
                Democratic health
              </h2>
              <DemocraticHealthBlock data={election.democraticHealth} />
            </div>
          ) : null}

          {vm.drivers.length + vm.coattailDrivers.length > 0 ? (
            <div style={{ marginTop: 24 }}>
              <h2
                style={{
                  margin: "0 0 4px",
                  fontFamily: FONT.sans,
                  fontSize: 20,
                  fontWeight: 600,
                }}
              >
                Why it moved
              </h2>
              <WhyItMovedBlock vm={vm} />
            </div>
          ) : null}

          {campaignLink}
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden lg:block">
        <BlendShell
          rightWidth={300}
          left={
            <BlendRail
              eyebrow="General election"
              title={`${election.countryId} President${election.electionYear ? ` ${election.electionYear}` : ""}`}
              titleSize={18}
              status={{ text: vm.liveText, color: BLEND.positive, pulse: true }}
              items={vm.railItems}
              selectedId={rail}
              onSelect={(id) => setRail(id as GeneralRail)}
            />
          }
          right={
            <aside
              style={{
                borderLeft: `1px solid ${BLEND.hairline}`,
                background: BLEND.rail,
                padding: "20px 18px",
                display: "flex",
                flexDirection: "column",
                gap: 22,
              }}
            >
              {vm.yourTicket ? (
                <div>
                  <div style={BLEND_LABEL}>Your ticket</div>
                  <YourTicketBlock vm={vm} campaignLink={campaignLink} />
                </div>
              ) : null}

              {vm.mood ? (
                <div style={{ paddingTop: 20, borderTop: `1px solid ${BLEND.hairline}` }}>
                  <div style={BLEND_LABEL}>National mood</div>
                  <NationalMoodBlock vm={vm} />
                </div>
              ) : null}

              {election.democraticHealth ? (
                <div style={{ paddingTop: 20, borderTop: `1px solid ${BLEND.hairline}` }}>
                  <div style={BLEND_LABEL}>Democratic health</div>
                  <DemocraticHealthBlock data={election.democraticHealth} />
                </div>
              ) : null}

              {vm.drivers.length + vm.coattailDrivers.length > 0 ? (
                <div style={{ paddingTop: 20, borderTop: `1px solid ${BLEND.hairline}` }}>
                  <div style={BLEND_LABEL}>Why it moved</div>
                  <WhyItMovedBlock vm={vm} />
                </div>
              ) : null}
            </aside>
          }
        >
          <BlendHeader
            kicker={vm.kicker}
            readout={vm.turnReadout}
            headline={vm.headline}
            standfirst={vm.standfirst}
            headlineSize={34}
          />
          {closeLine ? (
            <div style={{ padding: "10px 26px 0", background: BLEND.page }}>{closeLine}</div>
          ) : null}
          <BlendTicker tag="CALLS" items={vm.wire} />

          {vm.showCollege && heroPairTickets.length > 0 ? (
            <section
              style={{ padding: "24px 26px", borderBottom: `1px solid ${BLEND.hairlineStrong}` }}
            >
              {heroPager}
              {heroPair(
                {
                  name: 19,
                  party: 10,
                  mate: 13,
                  label: 9,
                  votes: 46,
                  share: 12,
                  projection: 25,
                  columnGap: 24,
                  marginBottom: 18,
                  avatarSize: "h-9 w-9",
                },
                heroPairTickets
              )}
              <EvBar vm={vm} height={34} error={endorseError} />
            </section>
          ) : null}

          {vm.showBoard && vm.tiles.length > 0 ? (
            <BlendSection
              title="The battleground board"
              lede="Margin tiers, the same shading the popular-vote map uses."
            >
              <TileBoard vm={vm} columns={11} electionId={electionId} />
              <TierLegend vm={vm} />
            </BlendSection>
          ) : null}

          {vm.showTickets && vm.showTicketsTable ? (
            <BlendSection
              title="The tickets"
              lede="Projected electoral votes · vote share"
              ruled={false}
            >
              {ticketRows}
            </BlendSection>
          ) : null}
        </BlendShell>
      </div>
    </>
  );
}

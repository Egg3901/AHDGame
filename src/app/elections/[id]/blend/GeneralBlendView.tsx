"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { BLEND, FONT } from "@/components/blend/tokens";
import { BlendShell, BlendHeader, BlendSection } from "@/components/blend/BlendShell";
import { BlendRail, BlendChipRail } from "@/components/blend/BlendRail";
import { BlendTicker } from "@/components/blend/BlendTicker";
import type { ElectionDetail } from "../components/ElectionDetailTypes";
import {
  buildGeneralBlendViewModel,
  type DriverRowVM,
  type GeneralBlendVM,
  type GeneralRail,
  type GeneralTicketVM,
} from "./generalBlendViewModel";

export interface GeneralBlendViewProps {
  election: ElectionDetail;
  electionId: string;
  wire: string[];
  onRefresh: () => void;
}

function EvBar({ vm, height }: { vm: GeneralBlendVM; height: number }) {
  return (
    <>
      <div style={{ position: "relative", height, display: "flex", background: BLEND.track }}>
        {vm.evSegments.map((s) => (
          <div
            key={s.id}
            style={{
              width: `${s.widthPct.toFixed(2)}%`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              background: s.color,
              color: "#fff",
              fontFamily: FONT.mono,
              fontWeight: 700,
              fontSize: 13,
            }}
          />
        ))}
        <div style={{ flex: 1 }} />
        {/* Majority marker at the live threshold, not a fixed 50.19%. */}
        <div
          style={{
            position: "absolute",
            top: -5,
            bottom: -5,
            left: `${vm.thresholdPct.toFixed(2)}%`,
            width: 1,
            background: BLEND.ink,
          }}
        />
      </div>
      <div
        style={{
          marginTop: 8,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: FONT.mono,
          fontSize: 10,
          letterSpacing: ".1em",
          color: BLEND.mutedDimmer,
        }}
      >
        <span>0</span>
        <span>{vm.threshold} TO WIN</span>
        <span>{vm.totalEv}</span>
      </div>
      {/* Nothing on this screen is won. It renders only while a race is
          running; a concluded one gets the results screen. Sits inside the bar
          so it cannot be added to one layout and forgotten in the other. */}
      <div
        style={{
          marginTop: 7,
          fontFamily: FONT.serif,
          fontSize: 12.5,
          fontStyle: "italic",
          color: BLEND.mutedDim,
        }}
      >
        {vm.projectionNote}
      </div>
    </>
  );
}

function DriverRows({ rows }: { rows: DriverRowVM[] }) {
  return (
    <>
      {rows.map((d) => (
        <div
          key={d.label}
          style={{ padding: "11px 0", borderBottom: "1px solid rgba(34,34,47,.7)" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <span style={{ fontFamily: FONT.serif, fontSize: 13.5 }}>{d.label}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 12, color: d.color }}>
              {d.value}
              {d.unit === "%" ? "%" : ""}
            </span>
          </div>
          <div
            style={{
              marginTop: 7,
              height: 3,
              background: BLEND.trackAlt,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <i
              style={{
                position: "absolute",
                inset: 0,
                width: `${d.barPct}%`,
                background: d.color,
                display: "block",
              }}
            />
          </div>
        </div>
      ))}
    </>
  );
}

function TileBoard({ vm, columns }: { vm: GeneralBlendVM; columns: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 4 }}>
      {vm.tiles.map((t) => (
        <div
          key={t.stateId}
          title={t.title}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            aspectRatio: "1",
            color: t.ink,
            background: t.background,
          }}
        >
          <span style={{ fontFamily: FONT.mono, fontSize: 10.5, fontWeight: 700 }}>
            {t.stateId}
          </span>
          <span style={{ fontFamily: FONT.mono, fontSize: 9, opacity: 0.75 }}>{t.ev}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Your own ticket's electoral votes and where that puts you.
 *
 * These three blocks are rendered without headings so each layout supplies its
 * own, and they appear in both trees. The desktop rail is `hidden lg:block`, so
 * a rail-only version of this one meant a player on a phone could not see their
 * own standing on their own election night.
 */
function YourTicketBlock({ vm, campaignLink }: { vm: GeneralBlendVM; campaignLink: ReactNode }) {
  if (!vm.yourTicket) return null;
  return (
    <>
      <div style={{ marginTop: 9, fontFamily: FONT.serif, fontSize: 17, fontWeight: 600 }}>
        {vm.yourTicket.name}
      </div>
      <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 9 }}>
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 34,
            fontWeight: 500,
            letterSpacing: "-0.03em",
          }}
        >
          {vm.yourTicket.ev}
        </span>
        <span
          style={{
            fontFamily: FONT.serif,
            fontSize: 14,
            color: vm.yourTicket.leadText.startsWith("+") ? BLEND.positive : BLEND.caution,
          }}
        >
          {vm.yourTicket.leadText}
        </span>
      </div>
      {campaignLink}
    </>
  );
}

/** The referendum standing the whole board is being judged against. */
function NationalMoodBlock({ vm }: { vm: GeneralBlendVM }) {
  if (!vm.mood) return null;
  return (
    <>
      <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 9 }}>
        <span style={{ fontFamily: FONT.mono, fontSize: 30, fontWeight: 500 }}>
          {vm.mood.approval}
        </span>
        <span style={{ fontFamily: FONT.serif, fontSize: 14, color: BLEND.muted }}>
          referendum points
        </span>
      </div>
      <p
        style={{
          margin: "9px 0 0",
          fontFamily: FONT.serif,
          fontSize: 13.5,
          lineHeight: 1.5,
          color: BLEND.muted,
        }}
      >
        {vm.mood.note}
      </p>
    </>
  );
}

/** What moved the vote, ticket drivers then coattails. */
function WhyItMovedBlock({ vm }: { vm: GeneralBlendVM }) {
  if (vm.drivers.length + vm.coattailDrivers.length === 0) return null;
  return (
    <>
      <DriverRows rows={vm.drivers} />
      <DriverRows rows={vm.coattailDrivers} />
    </>
  );
}

/** The board's colour key. Without it the tiles are colour with no legend. */
function TierLegend({ vm }: { vm: GeneralBlendVM }) {
  if (vm.tierLegend.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 14,
        display: "flex",
        flexWrap: "wrap",
        gap: "6px 18px",
        fontFamily: FONT.mono,
        fontSize: 10,
        color: BLEND.mutedDim,
      }}
    >
      <span style={{ letterSpacing: ".1em" }}>MARGIN TIERS:</span>
      {vm.tierLegend.map((l) => (
        <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <i style={{ width: 9, height: 9, display: "block", background: l.swatch }} />
          {l.label} <span style={{ opacity: 0.6 }}>{l.band}</span>
        </span>
      ))}
    </div>
  );
}

/** The Blend general-election screen (Proposal D). */
export function GeneralBlendView({ election, electionId, wire, onRefresh }: GeneralBlendViewProps) {
  const [rail, setRail] = useState<GeneralRail>("overview");
  const [busy, setBusy] = useState<string | null>(null);

  const vm = useMemo(
    () => buildGeneralBlendViewModel({ election, wire, rail }),
    [election, wire, rail]
  );

  async function toggleEndorse(candidateId: string, currentlyEndorsed: boolean) {
    setBusy(candidateId);
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
      if (res.ok) onRefresh();
    } catch {
      // Non-fatal: the row keeps its previous state until the next poll.
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
   * once means the affordance cannot go missing from one layout again.
   */
  const endorseButton = (c: GeneralTicketVM, align: "left" | "right") => (
    <button
      type="button"
      disabled={busy === c.id}
      onClick={() => toggleEndorse(c.id, c.endorsed)}
      style={{
        marginTop: 8,
        alignSelf: align === "right" ? "flex-end" : "flex-start",
        padding: "4px 10px",
        font: "inherit",
        fontFamily: FONT.mono,
        fontSize: 10.5,
        letterSpacing: ".06em",
        fontWeight: 700,
        textTransform: "uppercase",
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

  const heroPair = (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 24,
        marginBottom: 18,
      }}
    >
      {vm.topTwo.map((c, i) => (
        <div
          key={c.id}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: i === 0 ? "flex-start" : "flex-end",
            textAlign: i === 0 ? "left" : "right",
          }}
        >
          <div style={{ fontFamily: FONT.serif, fontSize: 19, fontWeight: 600 }}>{c.name}</div>
          <div
            style={{
              marginTop: 2,
              fontFamily: FONT.mono,
              fontSize: 10,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: BLEND.mutedDim,
            }}
          >
            {c.party}
          </div>
          {c.mate ? (
            <div
              style={{
                marginTop: 2,
                fontFamily: FONT.serif,
                fontStyle: "italic",
                fontSize: 13,
                color: BLEND.mutedDim,
              }}
            >
              with {c.mate}
            </div>
          ) : null}
          <div
            style={{
              marginTop: 7,
              fontFamily: FONT.mono,
              fontSize: 50,
              lineHeight: 1,
              fontWeight: 500,
              letterSpacing: "-0.04em",
              color: c.color,
            }}
          >
            {c.ev}
          </div>
          <div style={{ marginTop: 4, fontFamily: FONT.mono, fontSize: 12, color: BLEND.muted }}>
            {c.pct}% · {c.votes}
          </div>
          {endorseButton(c, i === 0 ? "left" : "right")}
        </div>
      ))}
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
        <span style={{ display: "block", fontFamily: FONT.serif, fontSize: 17, fontWeight: 600 }}>
          {c.name}
        </span>
        <span
          style={{
            display: "block",
            marginTop: 1,
            fontFamily: FONT.serif,
            fontStyle: "italic",
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
      <span style={{ display: "flex", justifyContent: "flex-end" }}>
        {endorseButton(c, "right")}
      </span>
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
              fontFamily: FONT.serif,
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
              fontFamily: FONT.serif,
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
          {vm.showCollege && vm.topTwo.length > 0 ? (
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", gap: 20 }}>
                {vm.topTwo.map((c) => (
                  <div key={c.id} style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                    <div style={{ fontFamily: FONT.serif, fontSize: 15, fontWeight: 600 }}>
                      {c.name}
                    </div>
                    {c.mate ? (
                      <div
                        style={{
                          marginTop: 2,
                          fontFamily: FONT.serif,
                          fontStyle: "italic",
                          fontSize: 12,
                          color: BLEND.mutedDim,
                        }}
                      >
                        with {c.mate}
                      </div>
                    ) : null}
                    <div
                      style={{
                        marginTop: 5,
                        fontFamily: FONT.mono,
                        fontSize: 38,
                        lineHeight: 1,
                        fontWeight: 500,
                        letterSpacing: "-0.04em",
                        color: c.color,
                      }}
                    >
                      {c.ev}
                    </div>
                    <div
                      style={{
                        marginTop: 3,
                        fontFamily: FONT.mono,
                        fontSize: 11,
                        color: BLEND.muted,
                      }}
                    >
                      {c.pct}%
                    </div>
                    {endorseButton(c, "left")}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 14 }}>
                <EvBar vm={vm} height={28} />
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
                  fontFamily: FONT.serif,
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
                  fontFamily: FONT.serif,
                  fontSize: 20,
                  fontWeight: 600,
                }}
              >
                The board
              </h2>
              <TileBoard vm={vm} columns={6} />
              <TierLegend vm={vm} />
            </div>
          ) : null}

          {vm.showTickets && vm.showTicketsTable ? (
            <div>
              <h2
                style={{ margin: "0 0 2px", fontFamily: FONT.serif, fontSize: 20, fontWeight: 600 }}
              >
                The tickets
              </h2>
              <p
                style={{
                  margin: "0 0 10px",
                  fontFamily: FONT.mono,
                  fontSize: 9.5,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: BLEND.mutedDimmer,
                }}
              >
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
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <span style={{ fontFamily: FONT.serif, fontSize: 16, fontWeight: 600 }}>
                      {c.name}
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
                        fontFamily: FONT.serif,
                        fontStyle: "italic",
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
                  fontFamily: FONT.serif,
                  fontSize: 20,
                  fontWeight: 600,
                }}
              >
                National mood
              </h2>
              <NationalMoodBlock vm={vm} />
            </div>
          ) : null}

          {vm.drivers.length + vm.coattailDrivers.length > 0 ? (
            <div style={{ marginTop: 24 }}>
              <h2
                style={{
                  margin: "0 0 4px",
                  fontFamily: FONT.serif,
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
              footnote="The final four turns carry a quarter of the vote; the earlier turns carried the rest."
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
                  <div
                    style={{
                      fontFamily: FONT.mono,
                      fontSize: 9.5,
                      letterSpacing: ".16em",
                      textTransform: "uppercase",
                      color: BLEND.mutedDimmer,
                    }}
                  >
                    Your ticket
                  </div>
                  <YourTicketBlock vm={vm} campaignLink={campaignLink} />
                </div>
              ) : null}

              {vm.mood ? (
                <div style={{ paddingTop: 20, borderTop: `1px solid ${BLEND.hairline}` }}>
                  <div
                    style={{
                      fontFamily: FONT.mono,
                      fontSize: 9.5,
                      letterSpacing: ".16em",
                      textTransform: "uppercase",
                      color: BLEND.mutedDimmer,
                    }}
                  >
                    National mood
                  </div>
                  <NationalMoodBlock vm={vm} />
                </div>
              ) : null}

              {vm.drivers.length + vm.coattailDrivers.length > 0 ? (
                <div style={{ paddingTop: 20, borderTop: `1px solid ${BLEND.hairline}` }}>
                  <div
                    style={{
                      fontFamily: FONT.mono,
                      fontSize: 9.5,
                      letterSpacing: ".16em",
                      textTransform: "uppercase",
                      color: BLEND.mutedDimmer,
                    }}
                  >
                    Why it moved
                  </div>
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
          <BlendTicker tag="CALLS" items={vm.wire} />

          {vm.showCollege && vm.topTwo.length > 0 ? (
            <section
              style={{ padding: "24px 26px", borderBottom: `1px solid ${BLEND.hairlineStrong}` }}
            >
              {heroPair}
              <EvBar vm={vm} height={34} />
            </section>
          ) : null}

          {vm.showBoard && vm.tiles.length > 0 ? (
            <BlendSection
              title="The battleground board"
              lede="Margin tiers, the same shading the popular-vote map uses."
            >
              <TileBoard vm={vm} columns={11} />
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

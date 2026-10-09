import { type ReactNode } from "react";
import { BLEND, FONT, BLEND_LABEL } from "@/components/blend/tokens";
import type { ElectionDetail } from "../components/ElectionDetailTypes";
import { type DriverRowVM, type GeneralBlendVM } from "./generalBlendViewModel";

export interface GeneralBlendViewProps {
  election: ElectionDetail;
  electionId: string;
  wire: string[];
  onRefresh: () => void;
  /** Desktop stage headline; defaults to "The <year> Presidential Election". */
  stageTitle?: string;
  /** Previous / next cycle links for the top of the stage's left rail. */
  stageNav?: ReactNode;
  /** A state to open on arrival (`?state=OH`). */
  initialFocus?: string | null;
}

export function EvBar({
  vm,
  height,
  error,
}: {
  vm: GeneralBlendVM;
  height: number;
  /** A refused endorsement, shown here because this sits under the buttons. */
  error?: string | null;
}) {
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
          fontFamily: FONT.sans,
          fontSize: 12.5,
          color: BLEND.mutedDim,
        }}
      >
        {vm.projectionNote} <Tip hint={vm.voteWeightHint}>Turn weighting.</Tip>
      </div>
      {error ? (
        <div
          style={{
            marginTop: 6,
            fontFamily: FONT.sans,
            fontSize: 13,
            color: BLEND.negative,
          }}
        >
          {error}
        </div>
      ) : null}
    </>
  );
}

/**
 * Dotted-underline tooltip. The explanations live here instead of as extra
 * prose lines, so the cards stay compact. Native `title`, matching the
 * PersuasionDrivers card's own hint pattern.
 */
function Tip({ hint, children }: { hint?: string | null; children: ReactNode }) {
  if (!hint) return <>{children}</>;
  return (
    <span
      title={hint}
      aria-label={hint}
      style={{
        textDecoration: "underline",
        textDecorationStyle: "dotted",
        textUnderlineOffset: 3,
        cursor: "help",
      }}
    >
      {children}
    </span>
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
            <span style={{ fontFamily: FONT.sans, fontSize: 13.5 }}>
              <Tip hint={d.hint}>{d.label}</Tip>
            </span>
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

/**
 * Your own ticket's electoral votes and where that puts you.
 *
 * These three blocks are rendered without headings so each layout supplies its
 * own, and they appear in both trees. The desktop rail is `hidden lg:block`, so
 * a rail-only version of this one meant a player on a phone could not see their
 * own standing on their own election night.
 */
export function YourTicketBlock({
  vm,
  campaignLink,
}: {
  vm: GeneralBlendVM;
  campaignLink: ReactNode;
}) {
  if (!vm.yourTicket) return null;
  return (
    <>
      <div style={{ marginTop: 9, fontFamily: FONT.sans, fontSize: 17, fontWeight: 600 }}>
        {vm.yourTicket.name}
      </div>
      <div style={{ ...BLEND_LABEL, marginTop: 9 }}>Current projection</div>
      <div style={{ marginTop: 3, display: "flex", alignItems: "baseline", gap: 9 }}>
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
            fontFamily: FONT.sans,
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

/**
 * The referendum standing the whole board is being judged against, with what
 * fed it.
 *
 * The components sit here rather than in a card further down the page. The
 * figure used to appear in both places under the same heading, and the bars
 * beneath each were different quantities — the block below this one is "Why it
 * moved", the persuasion drivers behind a candidate's vote, which is not what
 * moves this number. Keeping the economic components against the economic
 * figure is what tells the two apart.
 */
export function NationalMoodBlock({ vm }: { vm: GeneralBlendVM }) {
  if (!vm.mood) return null;
  const mood = vm.mood;
  return (
    <>
      <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 9 }}>
        <span style={{ fontFamily: FONT.mono, fontSize: 30, fontWeight: 500 }}>
          {mood.signedApproval}
        </span>
        <span style={{ fontFamily: FONT.sans, fontSize: 14, color: BLEND.muted }}>
          <Tip hint={mood.pointsHint}>referendum points</Tip>
        </span>
      </div>
      <p
        style={{
          margin: "9px 0 0",
          fontFamily: FONT.sans,
          fontSize: 13.5,
          lineHeight: 1.5,
          color: BLEND.muted,
        }}
      >
        {mood.effectNote}
      </p>
      <p
        style={{
          margin: "9px 0 0",
          fontFamily: FONT.sans,
          fontSize: 13.5,
          lineHeight: 1.5,
          color: BLEND.muted,
        }}
      >
        <Tip hint={mood.miseryHint}>Misery index {mood.misery}</Tip>
        {mood.median ? (
          <>
            {" · "}
            <Tip hint={mood.medianHint}>Median voter sits at {mood.median}</Tip>
          </>
        ) : null}
        .
      </p>
      {mood.components.length > 0 ? (
        <>
          <div style={{ ...BLEND_LABEL, margin: "14px 0 2px" }}>What feeds it</div>
          {mood.components.map((c) => (
            <div
              key={c.label}
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 10,
                padding: "7px 0",
                borderBottom: "1px solid rgba(34,34,47,.7)",
              }}
            >
              <span style={{ fontFamily: FONT.sans, fontSize: 13.5 }}>
                <Tip hint={c.hint}>{c.label}</Tip>
              </span>
              <span
                style={{
                  fontFamily: FONT.mono,
                  fontSize: 12,
                  color: c.positive ? BLEND.positive : BLEND.negative,
                }}
              >
                {c.value} pts
              </span>
            </div>
          ))}
        </>
      ) : null}
      {mood.credit ? (
        <p
          style={{
            margin: "8px 0 0",
            fontFamily: FONT.sans,
            fontSize: 12.5,
            lineHeight: 1.45,
            color: BLEND.mutedDim,
          }}
        >
          <Tip hint={mood.creditHint}>{mood.credit}</Tip>
        </p>
      ) : null}
      {mood.fatigue ? (
        <p
          style={{
            margin: "8px 0 0",
            fontFamily: FONT.sans,
            fontSize: 12.5,
            lineHeight: 1.45,
            color: BLEND.mutedDim,
          }}
        >
          <Tip hint={mood.fatigueHint}>{mood.fatigue}</Tip>
        </p>
      ) : null}
      <p
        style={{
          margin: "8px 0 0",
          fontFamily: FONT.sans,
          fontSize: 12.5,
          lineHeight: 1.45,
          color: BLEND.mutedDim,
        }}
      >
        {mood.readOn}
      </p>
    </>
  );
}

/** What moved the vote, ticket drivers then coattails. */
export function WhyItMovedBlock({ vm }: { vm: GeneralBlendVM }) {
  if (vm.drivers.length + vm.coattailDrivers.length === 0) return null;
  return (
    <>
      <DriverRows rows={vm.drivers} />
      <DriverRows rows={vm.coattailDrivers} />
      {vm.driversNote ? (
        <p
          style={{
            margin: "10px 0 0",
            fontFamily: FONT.sans,
            fontSize: 12.5,
            lineHeight: 1.45,
            color: BLEND.mutedDim,
          }}
        >
          {vm.driversNote}
        </p>
      ) : null}
    </>
  );
}

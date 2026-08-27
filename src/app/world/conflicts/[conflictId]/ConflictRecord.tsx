import type { ReactNode } from "react";
import { FrontLineMap } from "../combat/components/FrontLineMap";
import type { ConflictTier } from "@/lib/military/conflictVisibility";
import type { ForceRow, RecordBattleRow, SideForce } from "./conflictRecordView";
import { ConflictActions } from "./ConflictActions";
import { CommandChainPanel, CommandLockedPanel, HowThisFrontMoves } from "./CommandChainPanel";
import { EmployCommandPanel, type EmployableGeneral } from "./EmployCommandPanel";
import { MomentumPanel, type MomentumView } from "./MomentumPanel";
import { BelligerentsPanel, type BelligerentsView } from "./BelligerentsPanel";
import { ForcePanel } from "./ForcePanel";
import { OrderOfBattlePanel } from "./OrderOfBattlePanel";
import { WarLog } from "./WarLog";
import { NextTickStrip, type PendingChip } from "./NextTickStrip";
import { MIL_COLOR, MIL_FONT } from "../military/theme";
import type { CommandChainView } from "@/lib/military/commandChain";
import type { ConflictAssignment } from "@/lib/military/assignments";

const mono = MIL_FONT.mono;
const serif = MIL_FONT.serif;

export interface ConflictRecordView {
  conflictId: number;
  name: string;
  type: string;
  hostCountry: string;
  region: string;
  years: string;
  /** The calendar year the war opened, for the log's first row. */
  startYear: number;
  currentTurn: number;
  status: string;
  statusLabel: string;
  /** What the war was declared for; absent on conflicts predating declarations. */
  warGoal?: string;
  sideALabel: string;
  sideBLabel: string;
  sideACountries: string[];
  sideBCountries: string[];
  /** Faction entity on a proxy-war side (orients the front; not a belligerent). */
  sideAFaction?: string;
  sideBFaction?: string;
  /**
   * Belligerents present under a mutual-defence treaty rather than their own
   * declaration, already humanised by the page. Optional so a conflict with none (and
   * every existing test fixture) renders unchanged.
   */
  treatyNotes?: { country: string; organization: string; defending: string }[];
  /** Side B's share of the host, 0–100, and where it opened. */
  control: number;
  controlStart: number;
  /** Every entity the war is fought over, anchor first — the conflict zone.
   *  Absent means "just the anchor", as it does on the document. */
  hostEntities?: string[];
  /** The zone's drawable regions — geometry only, never ownership. */
  hostRegionCodes: string[];
  /** Whether the host itself fights on either side. */
  hostIsBelligerent: boolean;

  /** The one-sentence verdict over the front, and the sentence under it. */
  verdict: string;
  verdictDetail: string;
  /** How the war opened, stated under the control track. */
  opening: string;

  /** Headline totals, counted over the WHOLE history rather than the shown rows. */
  casualties: number;
  engagements: number;
  unopposedAdvances: number;
  lastEventLabel: string;
  lastEventValue: string;

  /** What resolves on the next tick. */
  pending: PendingChip[];
  momentum: MomentumView;
  /** Who is at this war and what put them there — see `belligerentRoll`.
   *  Optional for the same reason `hostEntities` is: a page rendered before this
   *  shipped carries no roll, and the record must still render without it. */
  belligerents?: BelligerentsView;

  /**
   * Settlements already agreed in this war, oldest first. Public: the war's
   * history should say why a country walked away, not merely that it did.
   */
  settlements?: Array<{
    id: string;
    leaver: string;
    other: string;
    indemnity: { payer: string; amount: number };
    justification: string | null;
    turn: number;
  }>;

  battles: RecordBattleRow[];
  /** How much of this conflict the viewer may see. */
  tier: ConflictTier;
  /** Whether the viewer may declare/withdraw here (canActAtTheater semantics). */
  canAct: boolean;
  viewerCountry: string | null;
  /** The viewer's side, or null when their nation is not a belligerent. */
  ownSide: "A" | "B" | null;
  /**
   * Where the viewer stands in this war and who does what they cannot. Null for a
   * viewer with no character — there is no seat to describe, and a logged-out
   * reader of the public record does not need to be told they hold none.
   */
  chain: CommandChainView | null;
  /** Everything ConflictActions needs; null when the viewer may not act here. */
  actions: {
    theaterId: string;
    countryCode: string;
    positionId: string;
    targets: string[];
    pendingTarget: string | null;
  } | null;
  /** The Commanding General's own generals + postings; null for every other seat. */
  employ: {
    countryCode: string;
    theaterId: string;
    generals: EmployableGeneral[];
    ownAssignments: ConflictAssignment[];
  } | null;
  /** Who declares here, in one sentence — public, and the citizen panel's payload. */
  whoDeclares: string;
  /**
   * The viewer's nation, once its units have fought here — a full belligerent.
   * Null when they hold no nation in this war, or it has not yet been engaged.
   */
  committedCountry: string | null;
  /** The viewer's nation's dead at this front, when it is a committed belligerent. */
  committedDead: number;

  /** Both sides' live force, at whatever resolution the tier allows. */
  forceA: SideForce;
  forceB: SideForce;
  /** `command` only — the viewer's live forces at this front. */
  ownForces?: ForceRow[];
  /** `command` only — a coarse read of the opposing force. */
  enemyBand?: string;
  /**
   * The viewer nation's unfunded upkeep share (0..1). Readiness recovery is projected
   * against the baseline this suppresses, so a force its nation cannot pay for is not
   * promised a climb the turn processor will never deliver. Absent = fully funded.
   */
  arrearsRatio?: number;
  readinessTier?: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  active: "#eab308",
  escalating: "#ff5a3c",
  winding_down: "#86d978",
  resolved: "#8a8a9a",
};

function StatTile({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return (
    <div
      style={{
        border: `1px solid ${MIL_COLOR.border}`,
        background: MIL_COLOR.panel,
        borderRadius: 10,
        padding: "9px 14px",
      }}
    >
      <div
        style={{ font: `600 8.5px ${mono}`, letterSpacing: ".14em", color: MIL_COLOR.textFaint }}
      >
        {label}
      </div>
      <div
        style={{
          font: `600 15px ${mono}`,
          color: tone === "amber" ? MIL_COLOR.amber : MIL_COLOR.text,
          marginTop: 3,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** The headline split: a two-tone track with the front's marker sitting on it. */
function ControlTrack({ pctA }: { pctA: number }) {
  return (
    <div
      style={{
        position: "relative",
        height: 24,
        borderRadius: 6,
        overflow: "hidden",
        border: `1px solid ${MIL_COLOR.border}`,
        display: "flex",
      }}
    >
      <div style={{ width: `${pctA}%`, background: MIL_COLOR.blue, opacity: 0.85 }} />
      <div style={{ flex: 1, background: MIL_COLOR.red, opacity: 0.85 }} />
      <div
        className="cw-fl-mark"
        style={{
          position: "absolute",
          top: -4,
          bottom: -4,
          left: `${pctA}%`,
          width: 3,
          marginLeft: -1.5,
          background: MIL_COLOR.textStrong,
          boxShadow: "0 0 14px 3px rgba(220,38,38,.6)",
        }}
      />
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: `1px solid ${MIL_COLOR.border}`,
        borderRadius: 12,
        background: MIL_COLOR.panel,
        padding: "14px 16px",
      }}
    >
      {children}
    </div>
  );
}

/**
 * One conflict's record: a single situation console rather than a stack of facts.
 *
 * Territory, cumulative casualties and battle outcomes are PUBLIC in every tier.
 * `command` (a posted general, the defense holder or the head of government of a
 * belligerent) additionally sees its own order of battle and a coarse read of the
 * enemy; `archive` (anyone, once the war resolves) sees both sides' per-engagement
 * rosters. The fog is applied SERVER-SIDE in conflictRecordView — this component
 * only renders what it was given, so nothing here is a client-side secret.
 *
 * Spec: docs/superpowers/specs/2026-07-26-conflict-ids-and-pages-design.md
 */
export function ConflictRecord({ conflict: c }: { conflict: ConflictRecordView }) {
  const statusColor = STATUS_COLOR[c.status] ?? "#8a8a9a";
  const pctB = Math.round(c.control);
  const pctA = 100 - pctB;
  const publicOnly = c.tier === "public";
  // "Nothing opposes you here" is a claim about a LIVE front seen from a side. A
  // resolved war has returned every unit to reserve, so both sides read as zero —
  // which would otherwise invite the reader to take ground in a finished war.
  const unopposed =
    c.status !== "resolved" &&
    c.ownSide !== null &&
    (c.ownSide === "A" ? c.forceB : c.forceA).divisions === 0;

  return (
    <div
      style={{
        padding: "26px clamp(14px, 3vw, 34px) 34px",
        fontFamily: MIL_FONT.sans,
        color: MIL_COLOR.text,
        background: "radial-gradient(120% 80% at 50% 0%,#16131a,#0b0b11 60%)",
      }}
    >
      <div
        style={{
          maxWidth: 1340,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* ── identity ────────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                font: `600 9px ${mono}`,
                letterSpacing: ".16em",
                color: MIL_COLOR.textFaint,
                textTransform: "uppercase",
              }}
            >
              Conflict record · #{c.conflictId} · {c.region}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 12,
                flexWrap: "wrap",
                marginTop: 6,
              }}
            >
              <h1
                className="cw-front-title"
                style={{
                  fontFamily: serif,
                  fontWeight: 600,
                  color: MIL_COLOR.textStrong,
                  margin: 0,
                  letterSpacing: "-.01em",
                }}
              >
                {c.name}
              </h1>
              <span
                style={{
                  font: `600 8.5px ${mono}`,
                  letterSpacing: ".08em",
                  padding: "3px 9px",
                  borderRadius: 6,
                  border: `1px solid ${statusColor}55`,
                  background: `${statusColor}1a`,
                  color: statusColor,
                  textTransform: "uppercase",
                }}
              >
                {c.statusLabel}
              </span>
            </div>
            <div style={{ font: `500 11px ${mono}`, color: "#7a7a8c", marginTop: 7 }}>
              {c.type} · hosted in {c.hostCountry} · {c.years} · turn {c.currentTurn}
              {c.warGoal ? ` · declared for ${c.warGoal}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <StatTile label="CASUALTIES" value={c.casualties.toLocaleString("en-US")} />
            <StatTile label="ENGAGEMENTS" value={String(c.engagements)} />
            <StatTile label={c.lastEventLabel} value={c.lastEventValue} tone="amber" />
          </div>
        </div>

        <NextTickStrip nextTurn={c.currentTurn + 1} chips={c.pending} />

        {/* Deploying to a friendly front is a commitment rather than a gesture,
            and nothing said so where the decision is actually made. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            border: "1px solid rgba(207,138,75,.35)",
            borderRadius: 12,
            background: "rgba(207,138,75,.06)",
            padding: "12px 16px",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              font: `600 9px ${mono}`,
              letterSpacing: ".14em",
              color: MIL_COLOR.amber,
              flexShrink: 0,
            }}
          >
            {c.committedCountry ? `${c.committedCountry} IS COMMITTED` : "COMMITMENT"}
          </span>
          <span
            className="cw-front-rule"
            style={{
              width: 1,
              alignSelf: "stretch",
              background: "rgba(207,138,75,.25)",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              font: `500 11px ${mono}`,
              color: "#c8c8d4",
              lineHeight: 1.6,
              flex: 1,
              minWidth: 240,
            }}
          >
            {c.committedCountry ? (
              <>
                Your units have fought here, so {c.committedCountry} is a full belligerent in this
                war — it ends by victory, capitulation or a separate peace, not by walking away.
                {c.committedDead > 0
                  ? ` ${c.committedDead.toLocaleString("en-US")} of your men have died at this front.`
                  : " No one of yours has died here yet."}
              </>
            ) : (
              <>
                Posting units here commits your country to this war the first time it fights — it
                then ends by victory, capitulation or a separate peace, not by walking away.
              </>
            )}
          </span>
        </div>

        {c.settlements && c.settlements.length > 0 && (
          <Panel>
            <div
              style={{
                font: `600 9px ${mono}`,
                letterSpacing: ".16em",
                color: MIL_COLOR.textFaint,
                marginBottom: 8,
              }}
            >
              SEPARATE PEACE
            </div>
            {c.settlements.map((s) => (
              <div
                key={s.id}
                style={{
                  marginTop: 8,
                  padding: 10,
                  border: "1px solid #23202b",
                  borderRadius: 8,
                  background: "#141119",
                }}
              >
                <div style={{ font: `500 12px ${mono}`, color: "#c9c9d6" }}>
                  {s.leaver} left the war on turn {s.turn}, settling with {s.other}
                  {s.indemnity.amount > 0
                    ? ` — ${s.indemnity.payer} paid ${s.indemnity.amount.toLocaleString("en-US")}`
                    : " — a white peace"}
                  .
                </div>
                {s.justification && (
                  <div
                    style={{
                      marginTop: 6,
                      paddingLeft: 8,
                      borderLeft: "2px solid #2c2836",
                      font: `italic 400 12px ${serif}`,
                      color: "#9a9aab",
                    }}
                  >
                    {s.justification}
                  </div>
                )}
              </div>
            ))}
          </Panel>
        )}

        {/* ── the verdict ─────────────────────────────────────────────── */}
        <div
          className="cw-front-verdict"
          style={{
            border: `1px solid ${MIL_COLOR.border}`,
            borderRadius: 14,
            background:
              "linear-gradient(90deg,rgba(59,130,246,.06),rgba(20,20,28,.4) 40%,rgba(220,38,38,.09))",
            padding: "22px 26px",
          }}
        >
          <div>
            <div
              style={{
                font: `600 9px ${mono}`,
                letterSpacing: ".16em",
                color: MIL_COLOR.textFaint,
              }}
            >
              STATE OF THE FRONT
            </div>
            <div
              style={{
                fontFamily: serif,
                fontSize: 29,
                fontWeight: 600,
                color: MIL_COLOR.textStrong,
                lineHeight: 1.24,
                marginTop: 9,
                textWrap: "pretty",
              }}
            >
              {c.verdict}
            </div>
            <div
              style={{
                font: `500 11.5px ${mono}`,
                color: MIL_COLOR.textMuted,
                marginTop: 10,
                lineHeight: 1.65,
              }}
            >
              {c.verdictDetail}
            </div>
          </div>
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end",
                gap: 16,
              }}
            >
              <div>
                <div
                  style={{ font: `600 9.5px ${mono}`, letterSpacing: ".12em", color: "#9cc0f5" }}
                >
                  {c.sideALabel}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                  <span style={{ font: `600 34px ${mono}`, color: MIL_COLOR.blue, lineHeight: 1 }}>
                    {pctA}
                  </span>
                  <span style={{ font: `600 13px ${mono}`, color: MIL_COLOR.blue }}>%</span>
                </div>
                <div
                  style={{ font: `500 9.5px ${mono}`, color: MIL_COLOR.textFaint, marginTop: 3 }}
                >
                  {c.sideACountries.length > 0
                    ? c.sideACountries.join(" · ")
                    : "No state belligerents"}
                </div>
              </div>
              <div
                style={{
                  font: `600 10px ${mono}`,
                  color: MIL_COLOR.textFaint,
                  paddingBottom: 10,
                  whiteSpace: "nowrap",
                }}
              >
                of {c.hostCountry}
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{ font: `600 9.5px ${mono}`, letterSpacing: ".12em", color: "#f0a0a0" }}
                >
                  {c.sideBLabel}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 4,
                    marginTop: 2,
                    justifyContent: "flex-end",
                  }}
                >
                  <span style={{ font: `600 34px ${mono}`, color: MIL_COLOR.red, lineHeight: 1 }}>
                    {pctB}
                  </span>
                  <span style={{ font: `600 13px ${mono}`, color: MIL_COLOR.red }}>%</span>
                </div>
                <div
                  style={{ font: `500 9.5px ${mono}`, color: MIL_COLOR.textFaint, marginTop: 3 }}
                >
                  {c.sideBCountries.length > 0
                    ? c.sideBCountries.join(" · ")
                    : "No state belligerents"}
                </div>
              </div>
            </div>
            {(c.treatyNotes ?? []).length > 0 ? (
              <div style={{ marginTop: 10 }}>
                {c.treatyNotes!.map((n) => (
                  <div
                    key={n.country}
                    style={{ font: `500 9.5px ${mono}`, color: MIL_COLOR.textFaint, marginTop: 2 }}
                  >
                    {n.country} entered under the {n.organization} to defend {n.defending}.
                  </div>
                ))}
              </div>
            ) : null}
            <div style={{ marginTop: 14 }}>
              <ControlTrack pctA={pctA} />
            </div>
            <div
              className="cw-front-track-ends"
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                font: `500 9.5px ${mono}`,
                color: MIL_COLOR.textFaint,
                marginTop: 7,
              }}
            >
              <span className="cw-front-track-end">{c.sideALabel.toUpperCase()}</span>
              <span style={{ color: "#8a8a9c", textAlign: "center" }}>{c.opening}</span>
              <span className="cw-front-track-end">{c.sideBLabel.toUpperCase()}</span>
            </div>
          </div>
        </div>

        {/* ── the front, and the seat looking at it ───────────────────── */}
        <div className="cw-front-body">
          <div className="cw-front-map">
            <FrontLineMap
              hostCountry={c.hostCountry}
              hostEntities={c.hostEntities}
              hostRegionCodes={c.hostRegionCodes}
              control={c.control}
              sideACountries={c.sideACountries}
              sideBCountries={c.sideBCountries}
              sideAFaction={c.sideAFaction}
              sideBFaction={c.sideBFaction}
              sideALabel={c.sideALabel}
              sideBLabel={c.sideBLabel}
            />
          </div>

          <div className="cw-front-rail">
            <BelligerentsPanel view={c.belligerents} />

            <MomentumPanel view={c.momentum} />

            <ForcePanel
              view={{
                sideALabel: c.sideALabel,
                sideBLabel: c.sideBLabel,
                ownSide: c.ownSide,
                a: c.forceA,
                b: c.forceB,
                enemyBand: c.enemyBand ?? null,
                unopposed,
                tier: c.tier,
              }}
            />

            {c.chain && <CommandChainPanel chain={c.chain} viewerCountry={c.viewerCountry} />}

            {/* The command surface — only for a viewer canActAtTheater would admit,
                and never on a resolved war. The routes enforce it again
                server-side; where it is absent, the reason takes its place. */}
            {c.canAct && c.actions ? (
              <ConflictActions {...c.actions} />
            ) : (
              c.chain?.locked && <CommandLockedPanel note={c.chain.locked} />
            )}

            {c.employ && <EmployCommandPanel {...c.employ} />}

            {publicOnly && <HowThisFrontMoves whoDeclares={c.whoDeclares} />}

            {c.ownForces && (
              <OrderOfBattlePanel
                view={{
                  title:
                    c.chain?.role === "theaterCommander"
                      ? "YOUR ORDER OF BATTLE"
                      : c.chain?.role === "postedGeneral"
                        ? "YOUR DIVISIONS AT THIS FRONT"
                        : c.chain?.role === "commandingGeneral"
                          ? "YOUR COMMAND AT THIS FRONT"
                          : "YOUR ORDER OF BATTLE",
                  forces: c.ownForces,
                  enemyBand: c.enemyBand ?? null,
                  enemyCountries: c.ownSide === "A" ? c.sideBCountries : c.sideACountries,
                  unopposed,
                  arrearsRatio: c.arrearsRatio,
                  readinessTier: c.readinessTier,
                }}
              />
            )}
          </div>
        </div>

        {c.battles.length === 0 && c.engagements === 0 && c.unopposedAdvances === 0 ? (
          <div
            style={{
              border: `1px dashed ${MIL_COLOR.border}`,
              borderRadius: 14,
              padding: "24px 20px",
              textAlign: "center",
              color: MIL_COLOR.textFaint,
              font: `500 12px ${mono}`,
            }}
          >
            No engagements yet — the front has not been contested.
          </div>
        ) : (
          <WarLog
            view={{
              battles: c.battles,
              sideACountries: c.sideACountries,
              note: `${c.engagements + c.unopposedAdvances} offensive${
                c.engagements + c.unopposedAdvances === 1 ? "" : "s"
              } · ${c.engagements} engagement${c.engagements === 1 ? "" : "s"} · ${
                publicOnly
                  ? "rosters withheld on both sides"
                  : c.tier === "archive"
                    ? "rosters open on both sides"
                    : "rosters shown for your side only"
              }`,
              opening: {
                year: c.startYear,
                text: `War declared. The line opened at ${100 - Math.round(c.controlStart)} / ${Math.round(c.controlStart)}.`,
              },
            }}
          />
        )}

        {/* The rule that turns a deployment into a war. Stated once more at the
            foot of the record, where a reader who scrolled past the banner ends
            up — a coalition front defends itself whether or not you meant it to. */}
        <div style={{ font: `500 11px ${mono}`, color: MIL_COLOR.textFaint, lineHeight: 1.6 }}>
          Allies posted to this front defend it automatically.
        </div>
      </div>
    </div>
  );
}

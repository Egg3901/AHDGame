"use client";

import { useState } from "react";
import { usePersistedNumber } from "./persisted";
import { useDefconState } from "./defcon";
import {
  CRISIS,
  CRED_START,
  NERVE_START,
  PC_START,
  RUNG_START,
  credColor,
  credMult,
  crisisDefconColor,
  crisisDefconNote,
  nerveColor,
  pcColor,
  step,
  type CrisisConfig,
  type CrisisKind,
  type Outcome,
  type StepResult,
} from "./crisis";
import type { Side } from "./proxyWar";

const mono = "'IBM Plex Mono',monospace";
const serif = "Lora,Georgia,serif";

type Wire = { who: string; c: string; t: string };

/** Outcome banner styling — shared across both sides; only title + sub differ. */
const OUT_STYLE: Record<Outcome, { icon: string; color: string; border: string; bg: string }> = {
  victory: {
    icon: "🕊️",
    color: "#86d978",
    border: "rgba(134,217,120,.4)",
    bg: "rgba(134,217,120,.07)",
  },
  war: { icon: "☢️", color: "#ff5a3c", border: "rgba(255,90,60,.45)", bg: "rgba(255,90,60,.09)" },
  climbdown: {
    icon: "🏳️",
    color: "#eab308",
    border: "rgba(234,179,8,.4)",
    bg: "rgba(234,179,8,.07)",
  },
};

/** Build the situation-room lines for a resolved move (chronological order). */
function moveLines(kind: CrisisKind, r: StepResult, cfg: CrisisConfig): Wire[] {
  const oppProper = cfg.oppName.charAt(0) + cfg.oppName.slice(1).toLowerCase();
  const self = (t: string): Wire => ({ who: cfg.selfName, c: cfg.selfColor, t });
  const opp = (t: string): Wire => ({ who: cfg.oppName, c: cfg.oppColor, t });
  const n = r.nerve;
  const lines: Wire[] = [];

  if (kind === "escalate") {
    lines.push(self(`climbs to “${cfg.rungs[r.rung - 1]}.” Readiness to DEFCON ${r.defcon}.`));
    if (r.rung >= 5) {
      if (r.outcome !== "war")
        lines.push(opp(`stares into the abyss — and looks away. (nerve ${n})`));
    } else {
      lines.push(
        opp(
          n < 45
            ? `wavers — ${cfg.escalateWaverBody}. (nerve ${n})`
            : `matches your move, defiant. (nerve ${n})`
        )
      );
    }
  } else if (kind === "hold") {
    lines.push(self(`holds firm at “${cfg.rungs[r.rung - 1]}.” No retreat, no escalation.`));
    lines.push(opp(`tests your resolve and finds it steady. (nerve ${n})`));
  } else if (kind === "channel") {
    lines.push(self(`opens a back-channel — offers ${oppProper} a quiet off-ramp. −10 PC.`));
    lines.push(opp(`listens. Tension eases a notch. (nerve ${n})`));
  } else if (kind === "standdown") {
    lines.push(
      self(
        `stands down to “${r.rung >= 1 ? cfg.rungs[r.rung - 1] : "diplomatic channels"}.” ${cfg.standdownLift}`
      )
    );
    if (r.outcome !== "climbdown")
      lines.push(opp(`senses weakness and presses its advantage. (nerve ${n})`));
  }
  return lines;
}

/** Crisis (West/East) — the Cuban Brigade brinkmanship mechanic. Faithful port. */
export function CrisisBoard({ side }: { side: Side }) {
  const cfg = CRISIS[side];
  const [rung, setRung] = useState(RUNG_START);
  const [nerve, setNerve] = useState(NERVE_START);
  const [round, setRound] = useState(1);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [log, setLog] = useState<Wire[]>([]);
  const [pc, setPc] = usePersistedNumber(cfg.pcKey, PC_START);
  const [defcon, setDefcon] = useDefconState();
  // Credibility is seeded once from the bloc's cohesion (set on the Conflicts
  // board); read-only here — it scales how hard your threats land.
  const [cred] = usePersistedNumber(cfg.cohesionKey, CRED_START, 0, 100);

  const cf = credMult(cred);
  const resolved = outcome !== null;

  const act = (kind: CrisisKind) => {
    if (resolved) return;
    const r = step({ rung, nerve, pc, defcon, cred }, kind);
    if (r.blocked) {
      setLog((l) =>
        [
          {
            who: cfg.channelLowActor,
            c: "#eab308",
            t: `back-channel needs 10 ${cfg.capitalWord} — reserve too low.`,
          },
          ...l,
        ].slice(0, 6)
      );
      return;
    }
    const lines = moveLines(kind, r, cfg);
    setRung(r.rung);
    setNerve(r.nerve);
    setPc(r.pc);
    setDefcon(r.defcon);
    setRound((x) => x + 1);
    setOutcome(r.outcome);
    setLog((l) => [...lines.reverse(), ...l].slice(0, 6));
  };

  const restart = () => {
    setRung(RUNG_START);
    setNerve(NERVE_START);
    setRound(1);
    setOutcome(null);
    setLog([{ who: cfg.restartActor, c: cfg.restartColor, t: cfg.restartText }]);
  };

  const out = outcome ? { ...OUT_STYLE[outcome], ...cfg.outcomes[outcome] } : null;

  const actions: {
    kind: CrisisKind;
    icon: string;
    name: string;
    detail: string;
    eff: string;
    effColor: string;
    danger: boolean;
  }[] = [
    {
      kind: "escalate",
      icon: "▲",
      name: "Escalate",
      detail:
        rung >= 4
          ? "Go to the nuclear rung. If their nerve holds, it is war."
          : `Climb the ladder — raise ${cfg.escalateLever}, force them to match or fold.`,
      eff: `−${Math.round(15 * cf)} ${cfg.nerveWord} nerve · +1 rung · −1 DEFCON`,
      effColor: "#ff7849",
      danger: rung >= 4,
    },
    {
      kind: "hold",
      icon: "■",
      name: "Hold firm",
      detail: "Stand pat. Project resolve without raising the stakes.",
      eff: `−${Math.round(7 * cf)} ${cfg.nerveWord} nerve`,
      effColor: cfg.effHoldColor,
      danger: false,
    },
    {
      kind: "channel",
      icon: "✉",
      name: "Back-channel",
      detail: `Spend ${cfg.capitalWord} to offer a face-saving off-ramp.`,
      eff: "−12 nerve · −10 PC · eases a rung",
      effColor: "#86d978",
      danger: false,
    },
    {
      kind: "standdown",
      icon: "▼",
      name: "Stand down",
      detail: `Lift the ${cfg.standdownObject}. Avoids war — but emboldens ${cfg.oppName.charAt(0) + cfg.oppName.slice(1).toLowerCase()} and costs prestige.`,
      eff: `+14 ${cfg.nerveWord} nerve · −1 rung · +1 DEFCON`,
      effColor: "#eab308",
      danger: false,
    },
  ];

  const nerveNote =
    nerve < 35 ? cfg.nerveLowNote : nerve < 60 ? "wavering, but holding" : "defiant and dug in";
  const credNote = cred >= 70 ? cfg.credNotes[0] : cred >= 50 ? cfg.credNotes[1] : cfg.credNotes[2];

  return (
    <div
      style={{
        padding: 26,
        fontFamily: "system-ui,-apple-system,sans-serif",
        color: "#e8e8ee",
        background: cfg.pageBg,
      }}
    >
      <div
        style={{
          maxWidth: 1500,
          margin: "0 auto",
          background: cfg.cardBg,
          border: `1px solid ${cfg.cardBorder}`,
          borderRadius: 10,
          boxShadow: "0 18px 50px -14px rgba(0,0,0,.7)",
          overflow: "hidden",
        }}
      >
        {/* flash strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "9px 20px",
            background: cfg.stripBg,
            borderBottom: `1px solid ${cfg.stripBorder}`,
          }}
        >
          <span style={{ font: `600 10px ${mono}`, letterSpacing: ".2em", color: "#ff7849" }}>
            {cfg.stripLeftText}
          </span>
          <span
            style={{ font: `500 10px ${mono}`, letterSpacing: ".15em", color: cfg.stripRightColor }}
          >
            ROUND {round} · DECISION WINDOW OPEN
          </span>
        </div>

        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 20,
            flexWrap: "wrap",
            padding: "20px 24px 14px",
          }}
        >
          <div>
            <p
              style={{
                margin: "0 0 5px",
                font: `600 10px ${mono}`,
                letterSpacing: ".22em",
                color: "#c98a52",
              }}
            >
              BRINKMANSHIP · ACTIVE CRISIS
            </p>
            <h1
              style={{
                margin: 0,
                fontFamily: serif,
                fontWeight: 700,
                fontSize: 32,
                lineHeight: 1.05,
                color: "#f3f1ea",
              }}
            >
              The Cuban Brigade Crisis
            </h1>
            <p
              style={{
                margin: "8px 0 0",
                maxWidth: 560,
                fontSize: 13,
                lineHeight: 1.5,
                color: "#9595a4",
              }}
            >
              {cfg.intro}
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div
              style={{
                border: "1px solid #44260f",
                background: "rgba(255,120,73,.08)",
                borderRadius: 10,
                padding: "11px 15px",
                minWidth: 104,
              }}
            >
              <span style={{ font: `600 9px ${mono}`, letterSpacing: ".16em", color: "#c98a52" }}>
                READINESS
              </span>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: serif,
                  fontWeight: 700,
                  fontSize: 24,
                  lineHeight: 1,
                  color: crisisDefconColor(defcon),
                }}
              >
                DEFCON {defcon}
              </div>
              <div style={{ marginTop: 3, font: `500 9px ${mono}`, color: "#7a6a52" }}>
                {crisisDefconNote(defcon)}
              </div>
            </div>
            <div
              style={{
                border: `1px solid ${cfg.pcPanelBorder}`,
                background: cfg.pcPanelBg,
                borderRadius: 10,
                padding: "11px 15px",
                minWidth: 104,
              }}
            >
              <span
                style={{ font: `600 9px ${mono}`, letterSpacing: ".16em", color: cfg.pcLabelColor }}
              >
                {cfg.pcLabel}
              </span>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: serif,
                  fontWeight: 700,
                  fontSize: 24,
                  lineHeight: 1,
                  color: pcColor(pc),
                }}
              >
                {pc}
              </div>
              <div style={{ marginTop: 3, font: `500 9px ${mono}`, color: cfg.pcSubColor }}>
                back-channel reserve
              </div>
            </div>
          </div>
        </div>

        {/* outcome banner */}
        {out && (
          <div
            style={{
              margin: "8px 24px 0",
              border: `1px solid ${out.border}`,
              background: out.bg,
              borderRadius: 12,
              padding: "16px 20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 24 }}>{out.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 21, color: out.color }}>
                  {out.title}
                </div>
                <div style={{ font: `500 11px ${mono}`, color: "#9595a4", marginTop: 3 }}>
                  {out.sub}
                </div>
              </div>
              <button
                onClick={restart}
                style={{
                  padding: "9px 18px",
                  borderRadius: 8,
                  cursor: "pointer",
                  font: `600 10.5px ${mono}`,
                  color: "#e8e8ee",
                  background: cfg.rerunBg,
                  border: `1px solid ${cfg.rerunBorder}`,
                }}
              >
                ↻ RERUN CRISIS
              </button>
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 16,
            padding: "16px 24px 24px",
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          {/* escalation ladder */}
          <div
            style={{
              width: 300,
              flexShrink: 0,
              border: `1px solid ${cfg.ladderBorder}`,
              background: cfg.ladderBg,
              borderRadius: 12,
              padding: "15px 16px",
            }}
          >
            <div
              style={{
                font: `700 10px ${mono}`,
                letterSpacing: ".14em",
                color: cfg.ladderLabelColor,
                marginBottom: 14,
              }}
            >
              ESCALATION LADDER
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {[5, 4, 3, 2, 1].map((num) => {
                const here = num === rung;
                const below = num < rung;
                const nuke = num === 5;
                return (
                  <div
                    key={num}
                    style={{ display: "flex", alignItems: "center", gap: 11, padding: "7px 0" }}
                  >
                    <span
                      style={{
                        width: 20,
                        textAlign: "center",
                        font: `700 12px ${mono}`,
                        color: here ? "#ff7849" : below ? "#7a7a8c" : "#54545f",
                      }}
                    >
                      {num}
                    </span>
                    <span
                      style={{
                        width: 13,
                        height: 13,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: here
                          ? nuke
                            ? "#ff5a3c"
                            : "#ff7849"
                          : below
                            ? "#3a3a48"
                            : "#1a1a25",
                        border: `2px solid ${here ? (nuke ? "#ff5a3c" : "#ff7849") : below ? "#54545f" : nuke ? "#7a4a4a" : cfg.ladderIdleBorder}`,
                        boxShadow: here ? `0 0 10px ${nuke ? "#ff5a3c" : "#ff7849"}` : "none",
                      }}
                    />
                    <span
                      style={{
                        font: `${here ? 700 : 500} ${here ? "12.5px" : "11.5px"} system-ui`,
                        color: here
                          ? "#f3f1ea"
                          : below
                            ? "#8a8a9a"
                            : nuke
                              ? "#8a6a6a"
                              : cfg.ladderIdleText,
                      }}
                    >
                      {cfg.rungs[num - 1]}
                    </span>
                    {here && (
                      <span
                        style={{ marginLeft: "auto", font: `600 8px ${mono}`, color: "#ff7849" }}
                      >
                        ◀ HERE
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div
              style={{
                marginTop: 14,
                paddingTop: 13,
                borderTop: `1px solid ${cfg.ladderBorder}`,
                font: `500 9px ${mono}`,
                color: cfg.ladderFootColor,
                lineHeight: 1.5,
              }}
            >
              rung 5 + escalate = the brink. If{" "}
              {cfg.oppName.charAt(0) + cfg.oppName.slice(1).toLowerCase()}&rsquo;s nerve
              hasn&rsquo;t broken, it means war.
            </div>
          </div>

          {/* standoff */}
          <div
            style={{ flex: 1, minWidth: 320, display: "flex", flexDirection: "column", gap: 14 }}
          >
            {/* nerve meters */}
            <div
              style={{
                border: `1px solid ${cfg.panelBorder}`,
                background: cfg.panelBg,
                borderRadius: 12,
                padding: "15px 18px",
              }}
            >
              <div style={{ marginBottom: 13 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      font: `600 10px ${mono}`,
                      letterSpacing: ".1em",
                      color: cfg.nerveDefiant,
                    }}
                  >
                    {cfg.nerveLabel}
                  </span>
                  <span
                    style={{ font: `700 13px ${mono}`, color: nerveColor(nerve, cfg.nerveDefiant) }}
                  >
                    {nerve}
                    <span style={{ fontSize: 9, color: "#6b6b7a" }}>/100</span>
                  </span>
                </div>
                <div
                  style={{
                    position: "relative",
                    height: 13,
                    borderRadius: 7,
                    background: "#0a0a12",
                    border: "1px solid #23232f",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      background: cfg.nerveBar,
                      width: `${nerve}%`,
                    }}
                  />
                </div>
                <div style={{ font: `500 9px ${mono}`, color: "#7a7a8c", marginTop: 5 }}>
                  {nerveNote}
                </div>
              </div>
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      font: `600 10px ${mono}`,
                      letterSpacing: ".1em",
                      color: cfg.credLabelColor,
                    }}
                  >
                    {cfg.credLabel}
                  </span>
                  <span style={{ font: `700 13px ${mono}`, color: credColor(cred) }}>
                    {cred}
                    <span style={{ fontSize: 9, color: "#6b6b7a" }}>/100</span>
                  </span>
                </div>
                <div
                  style={{
                    position: "relative",
                    height: 13,
                    borderRadius: 7,
                    background: "#0a0a12",
                    border: `1px solid ${cfg.credTrackBorder}`,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      background: cfg.credBar,
                      width: `${cred}%`,
                    }}
                  />
                </div>
                <div style={{ font: `500 9px ${mono}`, color: "#7a7a8c", marginTop: 5 }}>
                  {credNote}
                </div>
              </div>
            </div>

            {/* actions */}
            <div
              style={{
                border: `1px solid ${cfg.panelBorder}`,
                background: cfg.actionsBg,
                borderRadius: 12,
                padding: "15px 16px",
              }}
            >
              <div
                style={{
                  font: `700 10px ${mono}`,
                  letterSpacing: ".13em",
                  color: cfg.ladderLabelColor,
                  marginBottom: 12,
                }}
              >
                YOUR MOVE · ROUND {round}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                {actions.map((a) => (
                  <button
                    key={a.kind}
                    onClick={() => act(a.kind)}
                    disabled={resolved}
                    style={{
                      textAlign: "left",
                      border: `1px solid ${resolved ? "#23232f" : a.danger ? "rgba(255,90,60,.35)" : "rgba(255,255,255,.12)"}`,
                      borderRadius: 9,
                      background: resolved
                        ? "#131320"
                        : a.danger
                          ? "rgba(255,90,60,.05)"
                          : "rgba(255,255,255,.02)",
                      padding: "11px 13px",
                      cursor: resolved ? "not-allowed" : "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontSize: 14 }}>{a.icon}</span>
                      <span
                        style={{
                          font: "600 12px system-ui",
                          color: resolved ? "#6b6b7a" : "#e8e8ee",
                        }}
                      >
                        {a.name}
                      </span>
                    </div>
                    <div
                      style={{
                        font: `500 9px ${mono}`,
                        color: "#8a8a9a",
                        marginTop: 5,
                        lineHeight: 1.4,
                      }}
                    >
                      {a.detail}
                    </div>
                    <div
                      style={{
                        font: `600 8.5px ${mono}`,
                        color: resolved ? "#54545f" : a.effColor,
                        marginTop: 6,
                      }}
                    >
                      {a.eff}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* situation log */}
            <div
              style={{
                border: `1px solid ${cfg.transBorder}`,
                background: cfg.transBg,
                borderRadius: 11,
                padding: "12px 16px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: `1px dashed ${cfg.transDashTop}`,
                  paddingBottom: 7,
                  marginBottom: 5,
                }}
              >
                <span
                  style={{
                    font: `700 10px ${mono}`,
                    letterSpacing: ".13em",
                    color: cfg.logLabelColor,
                  }}
                >
                  {cfg.logLabel}
                </span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    font: `600 8.5px ${mono}`,
                    color: "#ff7849",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#ff7849",
                      boxShadow: "0 0 6px #ff7849",
                      animation: "cwBlink 1.4s infinite",
                    }}
                  />
                  LIVE
                </span>
              </div>
              {log.map((w, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 8,
                    padding: "5px 0",
                    borderBottom: `1px dashed ${cfg.transRowDash}`,
                  }}
                >
                  <span style={{ width: 3, flexShrink: 0, borderRadius: 2, background: w.c }} />
                  <div
                    style={{
                      flex: 1,
                      font: `500 10.5px ${mono}`,
                      lineHeight: 1.4,
                      color: cfg.transText,
                    }}
                  >
                    <span style={{ color: w.c }}>{w.who}</span> {w.t}
                  </div>
                </div>
              ))}
              {log.length === 0 && (
                <div style={{ padding: "8px 0", font: `500 10px ${mono}`, color: cfg.transEmpty }}>
                  {cfg.emptyWire}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

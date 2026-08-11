"use client";

import { useState } from "react";
import { usePersistedNumber } from "./persisted";
import { useDefconState } from "./defcon";
import {
  DETENTE,
  GW_START,
  PC_START,
  STAND_COST,
  canStandDown,
  defconMeta,
  goodwillAfterStand,
  goodwillAfterTable,
  nextDefcon,
  pcColor,
  posture,
  type Concession,
} from "./detente";
import type { Side } from "./proxyWar";

const mono = "'IBM Plex Mono',monospace";
const serif = "Lora,Georgia,serif";

type Wire = { who: string; c: string; t: string };

/** Détente (West/East) — the superpower-summit de-escalation mechanic. Faithful port. */
export function DetenteBoard({ side }: { side: Side }) {
  const cfg = DETENTE[side];
  const [goodwill, setGoodwill] = useState(GW_START);
  const [tabled, setTabled] = useState<Record<string, boolean>>({});
  const [pc, setPc] = usePersistedNumber(cfg.pcKey, PC_START);
  const [defcon, setDefcon] = useDefconState();
  const [log, setLog] = useState<Wire[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<"ok" | "err">("ok");

  const table = (c: Concession) => {
    if (tabled[c.id]) return;
    if (pc < c.cost) {
      setMsg(`Insufficient ${cfg.pcCurrency} — ${c.name} costs ${c.cost} PC.`);
      setMsgKind("err");
      return;
    }
    const gw = goodwillAfterTable(goodwill, c.trust);
    setTabled((m) => ({ ...m, [c.id]: true }));
    setGoodwill(gw);
    setPc(pc - c.cost);
    setLog((l) =>
      [
        {
          who: cfg.self.name,
          c: cfg.self.color,
          t: `tables: ${c.name.toLowerCase()}. Goodwill ${gw}.`,
        },
        ...l,
      ].slice(0, 5)
    );
    setMsg(null);
  };
  const standDown = () => {
    if (!canStandDown(goodwill, defcon, pc)) return;
    const nd = nextDefcon(defcon);
    setDefcon(nd);
    setGoodwill(goodwillAfterStand(goodwill));
    setPc(pc - STAND_COST);
    setLog((l) =>
      [
        {
          who: cfg.other.name,
          c: cfg.other.color,
          t: `agrees. Both sides step down — global readiness eases to DEFCON ${nd}.`,
        },
        ...l,
      ].slice(0, 5)
    );
    setMsg(`Stand-down agreed — readiness eased to DEFCON ${nd}. −${STAND_COST} PC.`);
    setMsgKind("ok");
  };
  const reset = () => {
    setGoodwill(GW_START);
    setTabled({});
    setLog([]);
    setMsg(null);
  };

  const post = posture(goodwill);
  const majorTabled = cfg.concessions.some((c) => c.major && tabled[c.id]);
  const canStand = canStandDown(goodwill, defcon, pc);
  const atPeace = defcon >= 5;
  const dm = defconMeta(defcon);

  const standNote = atPeace
    ? "Readiness is already at DEFCON 5 — the crisis has passed."
    : canStand
      ? cfg.standReciprocator
      : goodwill < 55
        ? cfg.standGateNote
        : pc < STAND_COST
          ? cfg.standPcNote
          : "";
  const standLabel = atPeace
    ? "AT PEACE · DEFCON 5"
    : canStand
      ? `⇊ STAND DOWN TO DEFCON ${nextDefcon(defcon)}`
      : "STAND DOWN LOCKED";

  const msgErr = msgKind === "err";

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
        {/* summit strip */}
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
          <span
            style={{ font: `600 10px ${mono}`, letterSpacing: ".2em", color: cfg.stripLeftColor }}
          >
            {cfg.stripLeftText}
          </span>
          <span
            style={{ font: `500 10px ${mono}`, letterSpacing: ".15em", color: cfg.stripRightColor }}
          >
            {cfg.stripRightText}
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
            padding: "20px 24px 16px",
          }}
        >
          <div>
            <p
              style={{
                margin: "0 0 5px",
                font: `600 10px ${mono}`,
                letterSpacing: ".24em",
                color: cfg.headerLabelColor,
              }}
            >
              DIPLOMACY · DE-ESCALATION
            </p>
            <h1
              style={{
                margin: 0,
                fontFamily: serif,
                fontWeight: 700,
                fontSize: 34,
                lineHeight: 1,
                color: "#f3f1ea",
              }}
            >
              Détente
            </h1>
            <p
              style={{
                margin: "8px 0 0",
                maxWidth: 580,
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
                  color: dm.color,
                }}
              >
                DEFCON {defcon}
              </div>
              <div style={{ marginTop: 3, font: `500 9px ${mono}`, color: "#7a6a52" }}>
                {dm.note}
              </div>
            </div>
            <div
              style={{
                border: `1px solid ${cfg.pcPanelBorder}`,
                background: cfg.pcPanelBg,
                borderRadius: 10,
                padding: "11px 15px",
                minWidth: 110,
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
                spent on concessions
              </div>
            </div>
          </div>
        </div>

        {/* summit progress */}
        <div
          style={{
            margin: "0 24px",
            border: `1px solid ${cfg.progBorder}`,
            background: cfg.progBg,
            borderRadius: 12,
            padding: "15px 18px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <span style={{ font: `600 10px ${mono}`, letterSpacing: ".14em", color: "#ef8a8a" }}>
              ⟵ HOSTILITY
            </span>
            <span style={{ font: `600 11px ${mono}`, color: post.color }}>
              {cfg.postureLabel} · {post.label}
            </span>
            <span style={{ font: `600 10px ${mono}`, letterSpacing: ".14em", color: "#86d978" }}>
              TRUST ⟶
            </span>
          </div>
          <div
            style={{
              position: "relative",
              height: 20,
              borderRadius: 10,
              overflow: "hidden",
              background: "linear-gradient(90deg,#7a2230,#23232f 45% 55%,#1f6b3a)",
              border: `1px solid ${cfg.progTrackBorder}`,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                width: 2,
                background: "#86d978",
                left: "55%",
                opacity: 0.6,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: -3,
                bottom: -3,
                width: 3,
                background: "#f3f1ea",
                boxShadow: "0 0 6px rgba(0,0,0,.8)",
                left: `${goodwill}%`,
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              font: `500 9px ${mono}`,
              color: cfg.progMuted,
              marginTop: 6,
            }}
          >
            <span>summit goodwill {goodwill}/100</span>
            <span style={{ color: "#86d978" }}>┊ stand-down unlocks at 55 →</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 16,
            padding: "16px 24px 24px",
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          {/* your concessions */}
          <div
            style={{
              flex: 1,
              minWidth: 320,
              border: `1px solid ${cfg.concBorder}`,
              background: cfg.concBg,
              borderRadius: 12,
              padding: "15px 16px",
            }}
          >
            <div
              style={{
                font: `700 11px ${mono}`,
                letterSpacing: ".13em",
                color: cfg.concLabelColor,
                marginBottom: 4,
              }}
            >
              ▮ ON THE TABLE · YOUR CONCESSIONS
            </div>
            <div style={{ font: `500 9px ${mono}`, color: cfg.concSubColor, marginBottom: 12 }}>
              each offer builds trust — but costs {cfg.pcCurrency} and gives something up
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {cfg.concessions.map((c) => {
                const on = !!tabled[c.id];
                const afford = pc >= c.cost;
                const ok = !on && afford;
                return (
                  <button
                    key={c.id}
                    onClick={() => table(c)}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 12,
                      textAlign: "left",
                      border: `1px solid ${on ? "rgba(134,217,120,.4)" : ok ? "rgba(255,255,255,.12)" : "#23232f"}`,
                      borderRadius: 9,
                      background: on
                        ? "rgba(134,217,120,.06)"
                        : ok
                          ? "rgba(255,255,255,.02)"
                          : "#131320",
                      padding: "11px 13px",
                      cursor: ok ? "pointer" : "default",
                    }}
                  >
                    <span style={{ flex: 1 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span
                          style={{
                            font: "600 12px system-ui",
                            color: on ? "#86d978" : ok ? "#e8e8ee" : "#6b6b7a",
                          }}
                        >
                          {c.name}
                        </span>
                        <span
                          style={{
                            font: `600 8px ${mono}`,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: c.major ? "rgba(234,179,8,.14)" : cfg.tagBg,
                            color: c.major ? "#eab308" : cfg.tagColor,
                          }}
                        >
                          {c.tag}
                        </span>
                      </span>
                      <span
                        style={{
                          display: "block",
                          font: `500 9px ${mono}`,
                          color: "#8a8a9a",
                          marginTop: 3,
                          lineHeight: 1.4,
                        }}
                      >
                        {c.detail}
                      </span>
                    </span>
                    <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <span
                        style={{
                          display: "block",
                          font: `700 11px ${mono}`,
                          color: on ? "#86d978" : ok ? cfg.trustOkColor : "#54545f",
                        }}
                      >
                        +{c.trust} trust
                      </span>
                      <span
                        style={{
                          display: "block",
                          font: `600 8.5px ${mono}`,
                          color: cfg.concSubColor,
                          marginTop: 2,
                        }}
                      >
                        {on ? "✓ TABLED" : afford ? `−${c.cost} PC` : `need ${c.cost} PC`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {majorTabled && (
              <div
                style={{
                  marginTop: 11,
                  padding: "9px 11px",
                  borderRadius: 8,
                  background: "rgba(234,179,8,.08)",
                  border: "1px solid rgba(234,179,8,.3)",
                  font: `600 9.5px ${mono}`,
                  color: "#eab308",
                  lineHeight: 1.4,
                }}
              >
                ⚠ {cfg.appeaseText}
              </div>
            )}
          </div>

          {/* responder + stand down */}
          <div
            style={{ width: 380, flexShrink: 0, display: "flex", flexDirection: "column", gap: 14 }}
          >
            <div
              style={{
                border: `1px solid ${cfg.respBorder}`,
                background: cfg.respBg,
                borderRadius: 12,
                padding: "15px 16px",
              }}
            >
              <div
                style={{
                  font: `700 11px ${mono}`,
                  letterSpacing: ".13em",
                  color: cfg.respLabelColor,
                  marginBottom: 12,
                }}
              >
                {cfg.respLabel}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {cfg.responses.map((s) => {
                  const rev = goodwill >= s.gate;
                  return (
                    <div key={s.gate} style={{ display: "flex", gap: 9, opacity: rev ? 1 : 0.45 }}>
                      <span style={{ fontSize: 14, flexShrink: 0 }}>{s.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            font: "500 11px system-ui",
                            color: rev ? cfg.respRevColor : "#54545f",
                            lineHeight: 1.4,
                          }}
                        >
                          {rev ? s.text : "— awaiting further concessions —"}
                        </div>
                        <div style={{ font: `600 8px ${mono}`, color: "#6b6b7a", marginTop: 2 }}>
                          {rev ? "reciprocated" : `unlocks at goodwill ${s.gate}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              style={{
                border: `1px solid ${canStand ? "rgba(134,217,120,.4)" : cfg.standBoxOffBorder}`,
                background: canStand ? "rgba(134,217,120,.05)" : cfg.standBoxOffBg,
                borderRadius: 12,
                padding: "15px 16px",
              }}
            >
              <div
                style={{
                  font: `700 11px ${mono}`,
                  letterSpacing: ".13em",
                  color: "#86d978",
                  marginBottom: 6,
                }}
              >
                ⇊ STAND DOWN
              </div>
              <p
                style={{
                  margin: "0 0 12px",
                  font: `500 10px ${mono}`,
                  color: "#9595a4",
                  lineHeight: 1.45,
                }}
              >
                {standNote}
              </p>
              <button
                onClick={standDown}
                style={{
                  width: "100%",
                  padding: "11px 0",
                  borderRadius: 8,
                  cursor: canStand ? "pointer" : "default",
                  font: `600 11px ${mono}`,
                  color: canStand ? "#0a0906" : "#54545f",
                  background: canStand ? "#86d978" : cfg.standOffBg,
                  border: `1px solid ${canStand ? "#86d978" : cfg.standOffBorder}`,
                }}
              >
                {standLabel}
              </button>
              <button
                onClick={reset}
                style={{
                  width: "100%",
                  marginTop: 8,
                  padding: "8px 0",
                  borderRadius: 8,
                  cursor: "pointer",
                  font: `600 9.5px ${mono}`,
                  color: "#8a8a9a",
                  background: cfg.resetBg,
                  border: `1px solid ${cfg.resetBorder}`,
                }}
              >
                RESET TABLE
              </button>
              {msg && (
                <div
                  style={{
                    marginTop: 11,
                    padding: "9px 12px",
                    borderRadius: 8,
                    background: msgErr ? "rgba(255,90,60,.08)" : "rgba(134,217,120,.08)",
                    border: `1px solid ${msgErr ? "rgba(255,90,60,.3)" : "rgba(134,217,120,.3)"}`,
                    font: `600 10px ${mono}`,
                    color: msgErr ? "#ff5a3c" : "#86d978",
                    lineHeight: 1.45,
                  }}
                >
                  {msg}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* transcript */}
        <div
          style={{
            margin: "0 24px 24px",
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
                color: cfg.transLabelColor,
              }}
            >
              ▌SUMMIT TRANSCRIPT
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                font: `600 8.5px ${mono}`,
                color: "#86d978",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#86d978",
                  boxShadow: "0 0 6px #86d978",
                }}
              />
              CHANNEL OPEN
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
              — the table is silent · make an opening offer —
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

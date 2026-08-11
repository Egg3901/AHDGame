"use client";

import { useState } from "react";
import { usePersistedNumber } from "./persisted";
import { useDefconState } from "./defcon";
import {
  ADDRESS_BUMP,
  ADDRESS_BUMP_MAX,
  ADDRESS_COST,
  EFFECT_COLORS,
  HOMEFRONT,
  PC_START,
} from "./homefront";
import type { Side } from "./proxyWar";

const mono = "'IBM Plex Mono',monospace";
const serif = "Lora,Georgia,serif";

/** Home Front (West) / Politburo (East) — the domestic politics of foreign policy. */
export function HomeFrontBoard({ side }: { side: Side }) {
  const cfg = HOMEFRONT[side];
  const [postures, setPostures] = useState<Record<string, boolean>>({});
  const [addressBump, setAddressBump] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgErr, setMsgErr] = useState(false);
  const [pc, setPc] = usePersistedNumber(cfg.pcKey, PC_START);
  const [defcon] = useDefconState();

  const m = cfg.compute(postures, defcon, addressBump);
  const big = cfg.bigStat(m);
  const strip = cfg.strip(m, defcon, pc);
  const factions = cfg.factions(m);
  const headlines = cfg.headlines(postures, defcon, m);

  const toggle = (id: string) => {
    setPostures((p) => ({ ...p, [id]: !p[id] }));
    setMsg(null);
  };
  const address = () => {
    if (pc < ADDRESS_COST) {
      setMsg(cfg.addressErr);
      setMsgErr(true);
      return;
    }
    setPc(pc - ADDRESS_COST);
    setAddressBump((b) => Math.min(ADDRESS_BUMP_MAX, b + ADDRESS_BUMP));
    setMsg(cfg.addressOk);
    setMsgErr(false);
  };
  const reset = () => {
    setPostures({});
    setAddressBump(0);
    setMsg(null);
  };

  const addrOk = pc >= ADDRESS_COST;

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
          maxWidth: 1600,
          margin: "0 auto",
          background: cfg.cardBg,
          border: `1px solid ${cfg.cardBorder}`,
          borderRadius: 10,
          boxShadow: "0 18px 50px -14px rgba(0,0,0,.7)",
          overflow: "hidden",
        }}
      >
        {/* strip */}
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
            padding: "20px 24px 14px",
          }}
        >
          <div>
            <p
              style={{
                margin: "0 0 5px",
                font: `600 10px ${mono}`,
                letterSpacing: ".22em",
                color: cfg.headerLabelColor,
              }}
            >
              {cfg.headerLabel}
            </p>
            <h1
              style={{
                margin: 0,
                fontFamily: serif,
                fontWeight: 700,
                fontSize: 32,
                lineHeight: 1,
                color: "#f3f1ea",
              }}
            >
              {cfg.title}
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
          <div
            style={{
              border: `1px solid ${big.border}`,
              background: big.bg,
              borderRadius: 10,
              padding: "11px 16px",
              minWidth: 160,
              textAlign: "center",
            }}
          >
            <span style={{ font: `600 9px ${mono}`, letterSpacing: ".16em", color: "#8a8a9a" }}>
              {cfg.bigStatLabel}
            </span>
            <div
              style={{
                marginTop: 5,
                fontFamily: serif,
                fontWeight: 700,
                fontSize: 34,
                lineHeight: 1,
                color: big.color,
              }}
            >
              {big.value}
              <span style={{ fontSize: 15 }}>%</span>
            </div>
            <div style={{ marginTop: 3, font: `600 9.5px ${mono}`, color: big.color }}>
              {big.tier}
            </div>
          </div>
        </div>

        {/* metric strip */}
        <div
          style={{
            display: "flex",
            margin: "6px 24px 0",
            border: `1px solid ${cfg.metricStripBorder}`,
            borderRadius: 12,
            overflow: "hidden",
            flexWrap: "wrap",
          }}
        >
          {strip.map((s, i) => (
            <div
              key={s.label}
              style={{
                flex: 1,
                minWidth: 150,
                padding: "13px 16px",
                borderRight: i < strip.length - 1 ? `1px solid ${cfg.metricStripBorder}` : "none",
              }}
            >
              <div
                style={{
                  font: `500 9px ${mono}`,
                  letterSpacing: ".1em",
                  color: cfg.stripLabelColor,
                }}
              >
                {s.label}
              </div>
              <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 22, color: s.color }}>
                {s.value}
                {s.suffix && <span style={{ fontSize: 12, color: "#8a8a9a" }}>{s.suffix}</span>}
              </div>
              <div style={{ font: `500 8.5px ${mono}`, color: cfg.stripSubColor }}>{s.sub}</div>
            </div>
          ))}
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
          {/* foreign → home */}
          <div
            style={{
              flex: 1,
              minWidth: 320,
              border: `1px solid ${cfg.panelBorder}`,
              background: cfg.panelBg,
              borderRadius: 12,
              padding: "15px 16px",
            }}
          >
            <div
              style={{
                font: `700 11px ${mono}`,
                letterSpacing: ".13em",
                color: cfg.postureTitleColor,
                marginBottom: 4,
              }}
            >
              {cfg.postureTitle}
            </div>
            <div
              style={{ font: `500 9px ${mono}`, color: cfg.factionLabelColor, marginBottom: 13 }}
            >
              {cfg.postureSub}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {cfg.postures.map((p) => {
                const on = !!postures[p.id];
                const ps = on ? cfg.postureActive : cfg.postureInactive;
                return (
                  <button
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    style={{
                      textAlign: "left",
                      border: `1px solid ${ps.border}`,
                      borderRadius: 10,
                      background: ps.bg,
                      padding: "12px 14px",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 15 }}>{p.icon}</span>
                        <span
                          style={{
                            font: "600 12.5px system-ui",
                            color: on ? "#f3f1ea" : "#9595a4",
                          }}
                        >
                          {p.name}
                        </span>
                      </span>
                      <span
                        style={{
                          font: `600 8.5px ${mono}`,
                          padding: "3px 9px",
                          borderRadius: 5,
                          background: ps.tagBg,
                          color: ps.tagColor,
                        }}
                      >
                        {on ? "ACTIVE" : "inactive"}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
                      {p.effects.map((e, i) => {
                        const ec = EFFECT_COLORS[e.kind];
                        return (
                          <span
                            key={i}
                            style={{
                              font: `600 8.5px ${mono}`,
                              padding: "2px 8px",
                              borderRadius: 99,
                              border: `1px solid ${ec.bd}`,
                              background: ec.bg,
                              color: ec.c,
                            }}
                          >
                            {e.text}
                          </span>
                        );
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* coalition + actions */}
          <div
            style={{ width: 400, flexShrink: 0, display: "flex", flexDirection: "column", gap: 14 }}
          >
            <div
              style={{
                border: `1px solid ${cfg.panelBorder}`,
                background: cfg.panelBg,
                borderRadius: 12,
                padding: "15px 16px",
              }}
            >
              <div
                style={{
                  font: `700 11px ${mono}`,
                  letterSpacing: ".13em",
                  color: cfg.factionLabelColor,
                  marginBottom: 13,
                }}
              >
                {cfg.coalitionTitle}
              </div>
              {factions.map((f) => (
                <div key={f.name} style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      marginBottom: 5,
                    }}
                  >
                    <span style={{ font: `600 10px ${mono}`, color: f.color }}>{f.name}</span>
                    <span style={{ font: `700 12px ${mono}`, color: f.color }}>{f.val}</span>
                  </div>
                  <div
                    style={{
                      position: "relative",
                      height: 10,
                      borderRadius: 6,
                      background: "#0a0a12",
                      border: `1px solid ${cfg.factionTrackBorder}`,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        background: f.color,
                        width: `${f.val}%`,
                      }}
                    />
                  </div>
                  <div
                    style={{ font: `500 8.5px ${mono}`, color: cfg.factionNoteColor, marginTop: 4 }}
                  >
                    {f.note}
                  </div>
                </div>
              ))}
            </div>

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
                  font: `700 11px ${mono}`,
                  letterSpacing: ".12em",
                  color: cfg.factionLabelColor,
                  marginBottom: 10,
                }}
              >
                {cfg.actionsTitle}
              </div>
              <button
                onClick={address}
                style={{
                  width: "100%",
                  padding: "10px 0",
                  borderRadius: 8,
                  cursor: addrOk ? "pointer" : "default",
                  font: `600 10.5px ${mono}`,
                  color: addrOk ? cfg.addrOnColor : "#54545f",
                  background: addrOk ? cfg.addrOnBg : cfg.addrOffBg,
                  border: `1px solid ${addrOk ? cfg.addrOnBorder : cfg.addrOffBorder}`,
                }}
              >
                {cfg.addressLabel}
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
                RESET POSTURE
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

        {/* headlines */}
        <div
          style={{
            margin: "0 24px 24px",
            border: `1px solid ${cfg.cablesBorder}`,
            background: cfg.cablesBg,
            borderRadius: 11,
            padding: "12px 16px",
          }}
        >
          <div
            style={{
              font: `700 10px ${mono}`,
              letterSpacing: ".13em",
              color: cfg.cablesLabelColor,
              borderBottom: `1px dashed ${cfg.cablesDashTop}`,
              paddingBottom: 7,
              marginBottom: 5,
            }}
          >
            {cfg.headlinesLabel}
          </div>
          {headlines.map((h, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 8,
                padding: "5px 0",
                borderBottom: `1px dashed ${cfg.cablesRowDash}`,
              }}
            >
              <span style={{ width: 3, flexShrink: 0, borderRadius: 2, background: h.c }} />
              <div
                style={{
                  flex: 1,
                  font: `500 10.5px ${mono}`,
                  lineHeight: 1.4,
                  color: cfg.headlineTextColor,
                }}
              >
                <span style={{ color: h.c, fontWeight: 600 }}>{h.src}</span> {h.t}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

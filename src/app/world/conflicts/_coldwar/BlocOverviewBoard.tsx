"use client";

import { useState } from "react";
import {
  BLOC,
  BLOC_SIDE,
  REG_ORDER,
  WIRE,
  PINS,
  actMessage,
  lookupNation,
  MAP_FILL,
  MAP_STROKE,
  MAP_HI,
  type BlocId,
  type BlocSide,
} from "./blocs";
import { defconColor, useDefcon } from "./defcon";
import { ClassificationStrip } from "./ClassificationStrip";
import { WorldBlocMap } from "./WorldBlocMap";
import { NationDetailPanel } from "./NationDetailPanel";

const mono = "'IBM Plex Mono',monospace";
const serif = "Lora,Georgia,serif";

type Selected = { name: string; bloc: BlocId } | null;
type Hover = { name: string; bloc: BlocId; x: number; y: number } | null;
type WireFilter = "all" | "west" | "east" | "wire" | "covert";

const THEATERS: { label: string; left: string; top: string }[] = [
  { label: "N. AMERICA", left: "15%", top: "20%" },
  { label: "S. AMERICA", left: "27%", top: "76%" },
  { label: "EUROPE", left: "49%", top: "13%" },
  { label: "AFRICA", left: "52%", top: "60%" },
  { label: "MIDDLE EAST", left: "60%", top: "40%" },
  { label: "ASIA", left: "73%", top: "28%" },
  { label: "OCEANIA", left: "87%", top: "72%" },
];

export function BlocOverviewBoard({ side = "west" }: { side?: BlocSide }) {
  const cfg = BLOC_SIDE[side];
  const defcon = useDefcon();
  const [selected, setSelected] = useState<Selected>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [wireFilter, setWireFilter] = useState<WireFilter>("all");
  const [view, setView] = useState<"list" | "cards">("list");
  const [sortKey, setSortKey] = useState<"name" | "lean">("lean");
  const [sortDir, setSortDir] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);

  function act(kind: string, nation: string) {
    setMsg(actMessage(side, kind, nation));
  }

  // register rows
  const order = [...REG_ORDER];
  if (sortKey === "name")
    order.sort((a, b) => lookupNation(a).name.localeCompare(lookupNation(b).name) * sortDir);
  else order.sort((a, b) => (lookupNation(a).lean - lookupNation(b).lean) * sortDir);

  const detail = selected ? lookupNation(selected.name, selected.bloc) : null;
  const hv = hover ? lookupNation(hover.name, hover.bloc) : null;
  const wire = WIRE.filter((w) => (wireFilter === "all" ? true : w.cat === wireFilter));

  const colorOf = (_name: string, bloc: BlocId, st: { selected: boolean; hovered: boolean }) => {
    if (st.selected) return { fill: MAP_HI[bloc], stroke: "#f3f1ea", strokeWidth: "1.6" };
    if (st.hovered) return { fill: MAP_HI[bloc], stroke: "#e8e8ee", strokeWidth: "1.1" };
    return { fill: MAP_FILL[bloc], stroke: MAP_STROKE[bloc], strokeWidth: "0.5" };
  };

  return (
    <div
      style={{
        padding: 26,
        fontFamily: "system-ui,-apple-system,sans-serif",
        color: "#e8e8ee",
        background: cfg.pageBg,
      }}
    >
      <div style={{ maxWidth: 1860, margin: "0 auto" }}>
        <div
          style={{
            background: cfg.cardBg,
            border: `1px solid ${cfg.cardBorder}`,
            borderRadius: 10,
            boxShadow: "0 18px 50px -12px rgba(0,0,0,.7)",
            overflow: "hidden",
          }}
        >
          <ClassificationStrip
            left={cfg.stripLeft}
            right="TURN 1 · WK 01 JAN 1979 · 02:14Z"
            leftColor={cfg.stripLeftColor}
            rightColor={cfg.stripRightColor}
            bg={cfg.stripBg}
            border={cfg.stripBorder}
          />

          <div className="cw-board">
            {/* LEFT: board */}
            <div className="cw-board-main">
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "space-between",
                  gap: 24,
                  flexWrap: "wrap",
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
                    {cfg.headerLabel}
                  </p>
                  <h1
                    style={{
                      margin: 0,
                      fontFamily: serif,
                      fontWeight: 700,
                      fontSize: 38,
                      lineHeight: 1,
                      letterSpacing: "-.01em",
                      color: "#f3f1ea",
                    }}
                  >
                    The World Divided
                  </h1>
                  <p
                    style={{
                      margin: "9px 0 0",
                      maxWidth: 540,
                      fontSize: 13,
                      lineHeight: 1.55,
                      color: "#9595a4",
                    }}
                  >
                    {cfg.intro}
                  </p>
                </div>
                <div
                  style={{
                    border: "1px solid #44260f",
                    background: "rgba(255,120,73,.08)",
                    borderRadius: 10,
                    padding: "11px 15px",
                    minWidth: 118,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "#ff7849",
                        boxShadow: "0 0 8px #ff7849",
                        animation: "cwBlink 1.6s infinite",
                      }}
                    />
                    <span
                      style={{ font: `600 9px ${mono}`, letterSpacing: ".18em", color: "#c98a52" }}
                    >
                      READINESS
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontFamily: serif,
                      fontWeight: 700,
                      fontSize: 24,
                      lineHeight: 1,
                      color: defconColor(defcon),
                    }}
                  >
                    DEFCON {defcon}
                  </div>
                  <div style={{ marginTop: 4, font: `500 9.5px ${mono}`, color: "#7a6a52" }}>
                    4 flashpoints · 2 escalating
                  </div>
                </div>
              </div>

              {/* balance */}
              <div
                style={{
                  border: "1px solid #2a2a3d",
                  background: "#11111a",
                  borderRadius: 12,
                  padding: "16px 18px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 11,
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      font: "600 11px system-ui",
                      color: "#7ba3ec",
                    }}
                  >
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: "#3b82f6" }} />
                    WESTERN BLOC{" "}
                    <span style={{ fontFamily: mono, fontSize: 13, color: "#e8e8ee" }}>52.4%</span>
                  </span>
                  <span
                    style={{ font: `600 10px ${mono}`, letterSpacing: ".13em", color: "#ca9a3a" }}
                  >
                    ⟂ 9 CONTESTED SWING STATES
                  </span>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      font: "600 11px system-ui",
                      color: "#ef8a8a",
                    }}
                  >
                    <span style={{ fontFamily: mono, fontSize: 13, color: "#e8e8ee" }}>47.6%</span>{" "}
                    EASTERN BLOC
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: "#dc2626" }} />
                  </span>
                </div>
                <div
                  style={{
                    position: "relative",
                    height: 18,
                    borderRadius: 9,
                    overflow: "hidden",
                    background: "rgba(212,175,55,.16)",
                    border: "1px solid #2a2a3d",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: "50%",
                      background: "linear-gradient(90deg,#1d4ed8,#3b82f6)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: "45.5%",
                      background: "linear-gradient(90deg,#ef4444,#dc2626)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      backgroundImage:
                        "repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(0,0,0,.2) 39px,rgba(0,0,0,.2) 40px)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: "51%",
                      top: -2,
                      bottom: -2,
                      width: 2,
                      background: "#f3f1ea",
                      boxShadow: "0 0 6px rgba(0,0,0,.6)",
                    }}
                  />
                </div>
              </div>

              {/* map */}
              <div
                style={{
                  border: "1px solid #2a2a3d",
                  background: "#0f0f17",
                  borderRadius: 12,
                  padding: "16px 18px 18px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 13,
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <span
                    style={{ font: `600 10px ${mono}`, letterSpacing: ".18em", color: "#6b6b7a" }}
                  >
                    ALIGNMENT MAP · BY THEATER
                  </span>
                  <div
                    style={{ display: "flex", gap: 15, font: `500 9px ${mono}`, color: "#7a7a8c" }}
                  >
                    <LegendSq fill="rgba(59,130,246,.4)" border="1px solid #3b82f6" label="WEST" />
                    <LegendSq
                      fill="rgba(212,175,55,.35)"
                      border="1px dashed #d4af37"
                      label="SWING"
                    />
                    <LegendSq fill="rgba(220,38,38,.4)" border="1px solid #dc2626" label="EAST" />
                    <LegendSq fill="#1c1c26" border="1px solid #2c2c38" label="NON-ALIGNED" />
                  </div>
                </div>

                <WorldBlocMap
                  interactive
                  colorOf={colorOf}
                  selected={selected?.name ?? null}
                  hovered={hover?.name ?? null}
                  vignette="radial-gradient(130% 95% at 50% 35%,transparent 58%,rgba(8,8,12,.5))"
                  onHoverNation={(name, bloc, x, y) => setHover(name ? { name, bloc, x, y } : null)}
                  onClickNation={(name, bloc) => {
                    setSelected({ name, bloc });
                    setMsg(null);
                  }}
                >
                  {THEATERS.map((t) => (
                    <div
                      key={t.label}
                      style={{
                        position: "absolute",
                        left: t.left,
                        top: t.top,
                        transform: "translate(-50%,-50%)",
                        font: `600 9px ${mono}`,
                        letterSpacing: ".22em",
                        color: "rgba(232,232,238,.32)",
                        textShadow: "0 1px 3px #000",
                        pointerEvents: "none",
                      }}
                    >
                      {t.label}
                    </div>
                  ))}

                  {PINS.map((p) => (
                    <div
                      key={p.name}
                      onClick={() => {
                        const n = lookupNation(p.name);
                        setSelected({ name: p.name, bloc: n.bloc });
                        setMsg(null);
                      }}
                      style={{
                        position: "absolute",
                        left: p.left,
                        top: p.top,
                        transform: "translate(-50%,-50%)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 2,
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          width: 11,
                          height: 11,
                          borderRadius: "50%",
                          background: "#f5c46a",
                          border: "1.5px solid #fff",
                          boxShadow: "0 0 10px #d4af37",
                          animation: "cwPulse 2.1s infinite",
                        }}
                      />
                      <span
                        style={{
                          font: `700 8px ${mono}`,
                          color: "#f5c46a",
                          textShadow: "0 1px 3px #000",
                        }}
                      >
                        {p.label}
                      </span>
                    </div>
                  ))}

                  {hv && hover && (
                    <div
                      style={{
                        position: "absolute",
                        left: `${hover.x}px`,
                        top: `${hover.y}px`,
                        transform: "translate(14px,14px)",
                        pointerEvents: "none",
                        zIndex: 6,
                        background: "#15151f",
                        border: "1px solid #2a2a3d",
                        borderRadius: 8,
                        padding: "8px 11px",
                        boxShadow: "0 8px 24px rgba(0,0,0,.6)",
                        minWidth: 150,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                          font: "600 12px system-ui",
                          color: "#f3f1ea",
                        }}
                      >
                        <span style={{ fontSize: 14 }}>{hv.flag}</span>
                        {hv.name}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          marginTop: 6,
                        }}
                      >
                        <span style={{ font: `600 9px ${mono}`, color: BLOC[hv.bloc].color }}>
                          {BLOC[hv.bloc].label}
                        </span>
                        <span style={{ font: `500 9px ${mono}`, color: "#8a8a9a" }}>
                          {hv.status}
                        </span>
                      </div>
                      <div
                        style={{
                          position: "relative",
                          height: 7,
                          marginTop: 7,
                          borderRadius: 4,
                          background: "linear-gradient(90deg,#1d4ed8,#23232f 45% 55%,#dc2626)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            top: -2,
                            bottom: -2,
                            width: 2,
                            background: "#f3f1ea",
                            left: `${hv.lean}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {detail && (
                    <NationDetailPanel
                      detail={detail}
                      side={side}
                      msg={msg}
                      onClose={() => {
                        setSelected(null);
                        setMsg(null);
                      }}
                      onAction={act}
                    />
                  )}
                </WorldBlocMap>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    marginTop: 10,
                    font: `500 9px ${mono}`,
                    color: "#7a7a8c",
                  }}
                >
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: "#f5c46a",
                      boxShadow: "0 0 7px #d4af37",
                    }}
                  />
                  FLASHPOINT · CONTESTED SWING STATE UNDER ACTIVE PRESSURE
                  <span style={{ marginLeft: "auto", color: "#54545f" }}>
                    110m equirectangular · hover or click a nation
                  </span>
                </div>
              </div>

              {/* bloc stats */}
              <div className="cw-blocstats">
                <BlocStat
                  tint="59,130,246"
                  color="#7ba3ec"
                  title="▮ WESTERN BLOC · NATO+"
                  members="14"
                  gdp="$7.1T"
                  warheads="11,200"
                />
                <BlocStat
                  tint="220,38,38"
                  color="#ef8a8a"
                  title="▮ EASTERN BLOC · WARSAW PACT"
                  members="9"
                  gdp="$3.4T"
                  warheads="12,800"
                />
              </div>
            </div>

            {/* RIGHT: register + wire */}
            <div className="cw-board-side">
              <div
                style={{
                  border: "1px solid #2a2a3d",
                  background: "#14141c",
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "11px 16px",
                    borderBottom: "1px solid #2a2a3d",
                  }}
                >
                  <span
                    style={{ font: `600 10px ${mono}`, letterSpacing: ".16em", color: "#6b6b7a" }}
                  >
                    ALIGNMENT REGISTER
                  </span>
                  <div style={{ display: "flex", gap: 5 }}>
                    <ViewBtn
                      on={view === "list"}
                      label="≡ LIST"
                      onClick={() => setView("list")}
                      t={cfg}
                    />
                    <ViewBtn
                      on={view === "cards"}
                      label="▤ CARDS"
                      onClick={() => setView("cards")}
                      t={cfg}
                    />
                  </div>
                </div>

                {view === "list" ? (
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "7px 16px",
                        font: `600 8.5px ${mono}`,
                        letterSpacing: ".1em",
                        color: "#6b6b7a",
                        borderBottom: "1px solid #2a2a3d",
                      }}
                    >
                      <span
                        onClick={() => {
                          setSortKey("name");
                          setSortDir((d) => (sortKey === "name" ? -d : 1));
                        }}
                        style={{ flex: 1, cursor: "pointer" }}
                      >
                        NATION {sortKey === "name" ? (sortDir > 0 ? "▾" : "▴") : ""}
                      </span>
                      <span style={{ width: 7 }} />
                      <span
                        onClick={() => {
                          setSortKey("lean");
                          setSortDir((d) => (sortKey === "lean" ? -d : 1));
                        }}
                        style={{ width: 76, cursor: "pointer" }}
                      >
                        ALIGNMENT {sortKey === "lean" ? (sortDir > 0 ? "▾" : "▴") : ""}
                      </span>
                      <span style={{ width: 42, textAlign: "right" }}>TREND</span>
                    </div>
                    {order.map((k, i) => {
                      const n = lookupNation(k);
                      const B = BLOC[n.bloc];
                      const seld = selected?.name === k;
                      return (
                        <div
                          key={k}
                          onClick={() => {
                            setSelected({ name: k, bloc: n.bloc });
                            setMsg(null);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "8px 16px",
                            cursor: "pointer",
                            borderLeft: `2px solid ${seld ? cfg.selColor : "transparent"}`,
                            background: seld ? cfg.selBg : i % 2 ? "#16161f" : "transparent",
                          }}
                        >
                          <span
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 7,
                              flex: 1,
                              minWidth: 0,
                              font: "600 11.5px system-ui",
                              color: "#e8e8ee",
                            }}
                          >
                            <span style={{ fontSize: 14 }}>{n.flag}</span>
                            <span
                              style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {n.name}
                            </span>
                          </span>
                          <span
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: 2,
                              flexShrink: 0,
                              background: B.dot,
                            }}
                          />
                          <span
                            style={{
                              position: "relative",
                              width: 76,
                              flexShrink: 0,
                              height: 7,
                              borderRadius: 4,
                              background: "linear-gradient(90deg,#1d4ed8,#23232f 45% 55%,#dc2626)",
                              overflow: "hidden",
                            }}
                          >
                            <span
                              style={{
                                position: "absolute",
                                top: -2,
                                bottom: -2,
                                width: 2,
                                background: "#f3f1ea",
                                left: `${n.lean}%`,
                              }}
                            />
                          </span>
                          <span
                            style={{
                              width: 42,
                              flexShrink: 0,
                              textAlign: "right",
                              font: `600 9.5px ${mono}`,
                              color: n.tc,
                            }}
                          >
                            {n.trend}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: 12 }}
                  >
                    {order.map((k) => {
                      const n = lookupNation(k);
                      const B = BLOC[n.bloc];
                      const seld = selected?.name === k;
                      return (
                        <div
                          key={k}
                          onClick={() => {
                            setSelected({ name: k, bloc: n.bloc });
                            setMsg(null);
                          }}
                          style={{
                            cursor: "pointer",
                            border: `1px solid ${seld ? cfg.selColor : "#2a2a3d"}`,
                            background: seld ? cfg.selBg : "#16161f",
                            borderRadius: 9,
                            padding: "9px 10px",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <span style={{ fontSize: 14 }}>{n.flag}</span>
                            <span
                              style={{
                                flex: 1,
                                font: "600 11px system-ui",
                                color: "#f3f1ea",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {n.name}
                            </span>
                            <span
                              style={{ width: 7, height: 7, borderRadius: 2, background: B.dot }}
                            />
                          </div>
                          <div
                            style={{
                              position: "relative",
                              width: "100%",
                              marginTop: 8,
                              height: 7,
                              borderRadius: 4,
                              background: "linear-gradient(90deg,#1d4ed8,#23232f 45% 55%,#dc2626)",
                              overflow: "hidden",
                            }}
                          >
                            <span
                              style={{
                                position: "absolute",
                                top: -2,
                                bottom: -2,
                                width: 2,
                                background: "#f3f1ea",
                                left: `${n.lean}%`,
                              }}
                            />
                          </div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginTop: 6,
                              font: `600 8.5px ${mono}`,
                              color: "#8a8a9a",
                            }}
                          >
                            <span style={{ color: B.color }}>{B.label}</span>
                            <span style={{ color: n.tc }}>{n.trend}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* wire */}
              <div
                style={{
                  position: "relative",
                  flex: 1,
                  minHeight: 250,
                  background: "#0a0906",
                  border: "1px solid #2a2416",
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    backgroundImage:
                      "repeating-linear-gradient(0deg,rgba(0,0,0,.32),rgba(0,0,0,.32) 1px,transparent 1px,transparent 3px)",
                    pointerEvents: "none",
                    zIndex: 3,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    height: 46,
                    background: "linear-gradient(180deg,rgba(255,193,77,.06),transparent)",
                    pointerEvents: "none",
                    zIndex: 2,
                    animation: "cwSweep 6s linear infinite",
                  }}
                />
                <div style={{ position: "relative", zIndex: 1, padding: "14px 16px 12px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      borderBottom: "1px dashed #4a3f1e",
                      paddingBottom: 9,
                    }}
                  >
                    <span
                      style={{ font: `700 11px ${mono}`, letterSpacing: ".16em", color: "#ffc14d" }}
                    >
                      ▌GLOBAL WIRE
                    </span>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        font: `600 9.5px ${mono}`,
                        color: "#86d978",
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: "#86d978",
                          boxShadow: "0 0 7px #86d978",
                          animation: "cwBlink 1.3s infinite",
                        }}
                      />
                      LIVE
                    </span>
                  </div>
                  <div style={{ marginTop: 4, minHeight: 150 }}>
                    {wire.length === 0 ? (
                      <div
                        style={{
                          padding: "18px 0",
                          textAlign: "center",
                          font: `500 10px ${mono}`,
                          color: "#5a4f30",
                        }}
                      >
                        — no traffic on this channel —
                      </div>
                    ) : (
                      wire.map((w, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            gap: 8,
                            padding: "7px 0",
                            borderBottom: "1px dashed #211c0e",
                          }}
                        >
                          <span
                            style={{
                              width: 3,
                              flexShrink: 0,
                              borderRadius: 2,
                              background: w.color,
                            }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                font: `600 8px ${mono}`,
                                letterSpacing: ".06em",
                                color: "#7a6430",
                              }}
                            >
                              {w.time}Z · <span style={{ color: w.color }}>{w.src}</span> · {w.tag}
                            </div>
                            <div
                              style={{
                                font: `500 11px ${mono}`,
                                lineHeight: 1.4,
                                color: "#d9aa55",
                                marginTop: 2,
                              }}
                            >
                              {w.text}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      borderTop: "1px dashed #4a3f1e",
                      paddingTop: 9,
                      marginTop: 2,
                    }}
                  >
                    <span
                      style={{ font: `600 9px ${mono}`, color: "#7a6430", alignSelf: "center" }}
                    >
                      FILTER ▸
                    </span>
                    {(["all", "west", "east", "wire", "covert"] as WireFilter[]).map((v) => {
                      const on = wireFilter === v;
                      const col =
                        v === "west"
                          ? "#6fa8dc"
                          : v === "east"
                            ? "#ff7849"
                            : v === "covert"
                              ? "#ef8a8a"
                              : "#ffc14d";
                      return (
                        <button
                          key={v}
                          onClick={() => setWireFilter(v)}
                          style={{
                            font: `600 8.5px ${mono}`,
                            padding: "3px 8px",
                            borderRadius: 5,
                            cursor: "pointer",
                            color: on ? "#0a0906" : col,
                            background: on ? col : "transparent",
                            border: `1px solid ${on ? col : "#3a3216"}`,
                          }}
                        >
                          {v.toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendSq({ fill, border, label }: { fill: string; border: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: fill, border }} />
      {label}
    </span>
  );
}

function ViewBtn({
  on,
  label,
  onClick,
  t,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  t: {
    viewOnBg: string;
    viewOnBorder: string;
    viewOnColor: string;
    viewOffBg: string;
    viewOffBorder: string;
    viewOffColor: string;
  };
}) {
  return (
    <button
      onClick={onClick}
      style={{
        font: `600 8.5px ${mono}`,
        padding: "3px 9px",
        borderRadius: 5,
        cursor: "pointer",
        background: on ? t.viewOnBg : t.viewOffBg,
        border: `1px solid ${on ? t.viewOnBorder : t.viewOffBorder}`,
        color: on ? t.viewOnColor : t.viewOffColor,
      }}
    >
      {label}
    </button>
  );
}

function BlocStat({
  tint,
  color,
  title,
  members,
  gdp,
  warheads,
}: {
  tint: string;
  color: string;
  title: string;
  members: string;
  gdp: string;
  warheads: string;
}) {
  return (
    <div
      style={{
        border: `1px solid rgba(${tint},.3)`,
        background: `rgba(${tint},.06)`,
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <div style={{ font: `700 11px ${mono}`, letterSpacing: ".16em", color, marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <StatCell value={members} label="MEMBERS" />
        <StatCell value={gdp} label="BLOC GDP" />
        <StatCell value={warheads} label="WARHEADS" />
      </div>
    </div>
  );
}

function StatCell({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 21, color: "#f3f1ea" }}>
        {value}
      </div>
      <div style={{ font: `500 9px ${mono}`, color: "#7a7a8c" }}>{label}</div>
    </div>
  );
}

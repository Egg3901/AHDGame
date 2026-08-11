"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { leanColor, sevStyle, type Conflict } from "./conflicts";
import { CW_ROUTES } from "./routes";
import { ClassificationStrip } from "./ClassificationStrip";
import { WorldBlocMap } from "./WorldBlocMap";

const mono = "'IBM Plex Mono',monospace";
const serif = "Lora,Georgia,serif";

/** Global Conflicts — "Conflicts of <in-game year>". Faithful port of the design page. */
export function GlobalConflictsBoard({ year, conflicts }: { year: number; conflicts: Conflict[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const activeCount = conflicts.length;
  const criticalCount = conflicts.filter((c) => c.sev === "CRITICAL").length;
  const hv = hover ? conflicts.find((c) => c.id === hover) : null;

  return (
    <div
      style={{
        padding: 26,
        fontFamily: "system-ui,-apple-system,sans-serif",
        color: "#e8e8ee",
        background: "radial-gradient(120% 80% at 50% 0%,#16131a,#0b0b11 60%)",
      }}
    >
      <div
        style={{
          maxWidth: 1340,
          margin: "0 auto",
          background: "#14141c",
          border: "1px solid #2a2a3d",
          borderRadius: 10,
          boxShadow: "0 18px 50px -14px rgba(0,0,0,.7)",
          overflow: "hidden",
        }}
      >
        <ClassificationStrip
          left="◆ GLOBAL SITUATION · ACTIVE CONFLICT REGISTER"
          right={`WEEK OF 01 JAN ${year}`}
        />

        {/* hero */}
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
                color: "#6b6b7a",
              }}
            >
              CONFLICTS · THE WORLD AT WAR
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
              Conflicts of {year}
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
              Every shooting war is a front in one larger one — the Cold War itself sits over all of
              them.
            </p>
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              justifyContent: "flex-end",
              minWidth: 0,
            }}
          >
            <Link
              href={CW_ROUTES.combat}
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                border: "1px solid rgba(220,38,38,.4)",
                background: "rgba(220,38,38,.08)",
                borderRadius: 10,
                padding: "11px 15px",
                minWidth: 104,
                textDecoration: "none",
              }}
            >
              <span style={{ font: `600 9px ${mono}`, letterSpacing: ".14em", color: "#d98a8a" }}>
                COMBAT
              </span>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: serif,
                  fontWeight: 700,
                  fontSize: 18,
                  lineHeight: 1.05,
                  color: "#f3f1ea",
                }}
              >
                Command →
              </div>
              <div style={{ marginTop: 3, font: `500 9px ${mono}`, color: "#7a7a8c" }}>
                order of battle
              </div>
            </Link>
            <Link
              href={CW_ROUTES.situation}
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                border: "1px solid rgba(59,130,246,.4)",
                background: "rgba(59,130,246,.08)",
                borderRadius: 10,
                padding: "11px 15px",
                minWidth: 104,
                textDecoration: "none",
              }}
            >
              <span style={{ font: `600 9px ${mono}`, letterSpacing: ".14em", color: "#7ba3ec" }}>
                SITUATION
              </span>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: serif,
                  fontWeight: 700,
                  fontSize: 18,
                  lineHeight: 1.05,
                  color: "#f3f1ea",
                }}
              >
                Board →
              </div>
              <div style={{ marginTop: 3, font: `500 9px ${mono}`, color: "#7a7a8c" }}>
                proxy theaters
              </div>
            </Link>
            <div
              style={{
                border: "1px solid #2a2a3d",
                background: "#1d1d2a",
                borderRadius: 10,
                padding: "11px 15px",
                minWidth: 92,
              }}
            >
              <span style={{ font: `600 9px ${mono}`, letterSpacing: ".14em", color: "#6b6b7a" }}>
                ACTIVE
              </span>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: serif,
                  fontWeight: 700,
                  fontSize: 24,
                  lineHeight: 1,
                  color: "#f3f1ea",
                }}
              >
                {activeCount}
              </div>
              <div style={{ marginTop: 3, font: `500 9px ${mono}`, color: "#7a7a8c" }}>
                conflicts
              </div>
            </div>
            <div
              style={{
                border: "1px solid #44260f",
                background: "rgba(255,120,73,.08)",
                borderRadius: 10,
                padding: "11px 15px",
                minWidth: 104,
              }}
            >
              <span style={{ font: `600 9px ${mono}`, letterSpacing: ".14em", color: "#c98a52" }}>
                CRITICAL
              </span>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: serif,
                  fontWeight: 700,
                  fontSize: 24,
                  lineHeight: 1,
                  color: criticalCount > 0 ? "#ff7849" : "#86d978",
                }}
              >
                {criticalCount}
              </div>
              <div style={{ marginTop: 3, font: `500 9px ${mono}`, color: "#7a6a52" }}>
                active fronts
              </div>
            </div>
          </div>
        </div>

        {/* map */}
        <div
          style={{
            margin: "0 24px",
            border: "1px solid #2a2a3d",
            background: "#0f0f17",
            borderRadius: 12,
            padding: "14px 16px 16px",
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
            <span style={{ font: `600 10px ${mono}`, letterSpacing: ".16em", color: "#6b6b7a" }}>
              THEATER MAP · FLASHPOINTS &amp; PROXY WARS
            </span>
            <div style={{ display: "flex", gap: 14, font: `500 9px ${mono}`, color: "#7a7a8c" }}>
              <LegendDot color="#3b82f6" label="WEST-BACKED" />
              <LegendDot color="#d4af37" label="CONTESTED" />
              <LegendDot color="#dc2626" label="EAST-BACKED" />
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: "transparent",
                    boxShadow: "0 0 0 1.5px #6b6b7a inset",
                  }}
                />
                larger = more intense
              </span>
            </div>
          </div>

          <WorldBlocMap
            interactive={false}
            colorOf={() => ({ fill: "#191922", stroke: "#262633", strokeWidth: "0.4" })}
          >
            {/* cold war axis */}
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            >
              <line
                x1="28.6"
                y1="32.4"
                x2="60.3"
                y2="20.4"
                stroke="#6b6b7a"
                strokeWidth="1.4"
                strokeDasharray="2 1.6"
                opacity="0.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {/* flashpoint pins */}
            {conflicts.map((k) => {
              // No anchor for this host — it stays in the list below, off the map.
              if (k.x == null || k.y == null) return null;
              const sel = selected === k.id;
              const sz = 8 + Math.round((k.intensity / 100) * 9);
              // A war neither bloc backs has no position on the west↔east axis.
              const col = k.lean == null ? "#8a8a9a" : leanColor(k.lean);
              return (
                <div
                  key={k.id}
                  data-pin={k.id}
                  onClick={() => {
                    setSelected(k.id);
                    setHover(k.id);
                  }}
                  style={{
                    position: "absolute",
                    left: `${k.x}%`,
                    top: `${k.y}%`,
                    transform: "translate(-50%,-50%)",
                    cursor: "pointer",
                    zIndex: sel ? 5 : 3,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: "50%",
                      transform: "translate(-50%,-50%)",
                      width: sz * 2.6,
                      height: sz * 2.6,
                      borderRadius: "50%",
                      border: `1.5px solid ${col}`,
                      opacity: k.escalating ? 0.9 : 0,
                    }}
                  />
                  <span
                    style={{
                      position: "relative",
                      display: "block",
                      width: sel ? sz + 4 : sz,
                      height: sel ? sz + 4 : sz,
                      borderRadius: "50%",
                      background: col,
                      border: sel ? "2px solid #f3f1ea" : "1.5px solid rgba(255,255,255,.55)",
                      boxShadow: `0 0 9px ${col}`,
                    }}
                  />
                </div>
              );
            })}
            {/* axis endpoints */}
            <div
              style={{
                position: "absolute",
                left: "28.6%",
                top: "32.4%",
                transform: "translate(-50%,-50%)",
                pointerEvents: "none",
                zIndex: 2,
              }}
            >
              <span
                style={{
                  display: "block",
                  width: 9,
                  height: 9,
                  borderRadius: 2,
                  background: "#3b82f6",
                  boxShadow: "0 0 8px #3b82f6",
                }}
              />
            </div>
            <div
              style={{
                position: "absolute",
                left: "60.3%",
                top: "20.4%",
                transform: "translate(-50%,-50%)",
                pointerEvents: "none",
                zIndex: 2,
              }}
            >
              <span
                style={{
                  display: "block",
                  width: 9,
                  height: 9,
                  borderRadius: 2,
                  background: "#dc2626",
                  boxShadow: "0 0 8px #dc2626",
                }}
              />
            </div>
            {/* hover label — positioned, so only for a conflict that has a pin.
                setHover also fires from the LIST cards, and an unanchored conflict is
                listed without a pin: without this guard it would render at
                `left: "null%"` and jump to the map corner. */}
            {hv && hv.x != null && hv.y != null && (
              <div
                data-hover-label
                style={{
                  position: "absolute",
                  left: `${hv.x}%`,
                  top: `${hv.y}%`,
                  transform: "translate(-50%,-150%)",
                  pointerEvents: "none",
                  zIndex: 9,
                  background: "#15151f",
                  border: "1px solid #2a2a3d",
                  borderRadius: 7,
                  padding: "5px 9px",
                  whiteSpace: "nowrap",
                  boxShadow: "0 6px 18px rgba(0,0,0,.6)",
                }}
              >
                <span style={{ font: "600 10.5px system-ui", color: "#f3f1ea" }}>{hv.name}</span>
                <span
                  style={{ font: `600 8.5px ${mono}`, color: sevStyle(hv.sev).c, marginLeft: 6 }}
                >
                  {hv.sev}
                </span>
              </div>
            )}
          </WorldBlocMap>
        </div>

        {/* regional conflict cards */}
        <div style={{ padding: "14px 24px 24px" }}>
          <div
            style={{
              font: `600 10px ${mono}`,
              letterSpacing: ".14em",
              color: "#6b6b7a",
              margin: "6px 2px 12px",
            }}
          >
            REGIONAL CONFLICTS · FRONTS OF THE GREATER STRUGGLE
          </div>
          {conflicts.length === 0 ? (
            <div
              style={{
                border: "1px dashed #2a2a3d",
                borderRadius: 12,
                padding: "28px 20px",
                textAlign: "center",
                color: "#6b6b7a",
                font: `500 12px ${mono}`,
                lineHeight: 1.6,
              }}
            >
              No active conflicts.
              <br />
              The world holds at an uneasy peace — the Cold War endures beneath it.
            </div>
          ) : (
            <div className="cw-conflict-grid">
              {conflicts.map((c) => {
                const sel = selected === c.id;
                const sv = sevStyle(c.sev);
                return (
                  <div
                    key={c.id}
                    onClick={() => router.push(`/world/conflicts/${c.conflictId}`)}
                    onMouseEnter={() => {
                      setSelected(c.id);
                      setHover(c.id);
                    }}
                    style={{
                      cursor: "pointer",
                      border: `1px solid ${sel ? "rgba(255,255,255,.3)" : "#2a2a3d"}`,
                      background: sel ? "#1d1d2a" : "#1a1a25",
                      borderRadius: 12,
                      padding: "14px 16px",
                      transition: "border-color .12s",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <span style={{ font: "600 14px system-ui", color: "#f3f1ea" }}>
                            {c.name}
                          </span>
                          <span
                            style={{
                              font: `600 8px ${mono}`,
                              padding: "2px 7px",
                              borderRadius: 4,
                              background: "#1d1d2a",
                              border: "1px solid #2a2a3d",
                              color: "#8a8a9a",
                            }}
                          >
                            {c.type}
                          </span>
                        </div>
                        <div style={{ font: `500 9.5px ${mono}`, color: "#7a7a8c", marginTop: 3 }}>
                          {c.region} · {c.years}
                        </div>
                      </div>
                      <span
                        style={{
                          font: `600 8.5px ${mono}`,
                          padding: "3px 9px",
                          borderRadius: 6,
                          background: sv.bg,
                          border: `1px solid ${sv.bd}`,
                          color: sv.c,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.sev}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                      <span
                        style={{
                          flex: 1,
                          textAlign: "right",
                          font: "500 10px system-ui",
                          color: c.lean == null ? "#cfcfda" : "#9cc0f5",
                        }}
                      >
                        {c.west}
                      </span>
                      <span style={{ font: `700 9px ${mono}`, color: "#6b6b7a", flexShrink: 0 }}>
                        ⚔
                      </span>
                      <span
                        style={{
                          flex: 1,
                          font: "500 10px system-ui",
                          color: c.lean == null ? "#cfcfda" : "#f0a0a0",
                        }}
                      >
                        {c.east}
                      </span>
                    </div>

                    {/* A west↔east gradient asserts a bloc alignment, so it is drawn
                        only for a conflict a bloc actually backs. */}
                    {c.lean != null && (
                      <div
                        data-lean-bar
                        style={{
                          position: "relative",
                          height: 9,
                          borderRadius: 5,
                          marginTop: 11,
                          background: "linear-gradient(90deg,#1d4ed8,#23232f 46% 54%,#dc2626)",
                          overflow: "hidden",
                          border: "1px solid #23232f",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            top: -2,
                            bottom: -2,
                            width: 3,
                            background: "#f3f1ea",
                            boxShadow: "0 0 5px rgba(0,0,0,.8)",
                            left: `${c.lean}%`,
                          }}
                        />
                      </div>
                    )}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        font: `500 9px ${mono}`,
                        color: "#7a7a8c",
                        marginTop: 7,
                      }}
                    >
                      <span>{c.status}</span>
                      <span style={{ color: c.sev === "CRITICAL" ? "#ff9d8a" : "#8a8a9a" }}>
                        {c.deaths}
                      </span>
                    </div>
                    <div
                      style={{
                        marginTop: 9,
                        paddingTop: 9,
                        borderTop: "1px solid #23232f",
                        font: `600 8.5px ${mono}`,
                        letterSpacing: ".06em",
                        color: "#8a8a9a",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 5,
                      }}
                    >
                      OPEN THEATER COMMAND <span style={{ color: "#cfcfda" }}>▸</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}

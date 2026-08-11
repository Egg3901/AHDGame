"use client";

import { useEffect, useState } from "react";
import { usePersistedNumber, writePersistedNumber } from "./persisted";
import { useDefconState } from "./defcon";
import {
  PC_MAX,
  PC_REGEN,
  UPKEEP_RATE,
  aggregates,
  cohColor,
  cohesionFrom,
  combatPower,
  commitColor,
  composition,
  conseqKind,
  fmtN,
  fmtTroops,
  pcCostFor,
  shadeOf,
  upkeepFor,
  type Member,
} from "./orgForces";
import { WP_BASE_COHESION, WP_MEMBERS, WP_TREATY_FLOOR } from "./warsawPact";

const mono = "'IBM Plex Mono',monospace";
const serif = "Lora,Georgia,serif";
const ACCENT = "#dc2626";

/** Warsaw Pact Command (East) — STAVKA's unified-command force-commitment console. */
export function WarsawPactBoard() {
  const [override, setOverride] = useState<number | null>(null);
  const [orderMsg, setOrderMsg] = useState<string | null>(null);
  const [role, setRole] = useState<"mod" | "hog">("mod");
  const [turn, setTurn] = useState(1);
  const [sortKey, setSortKey] = useState<"commit" | "name">("commit");
  const [sortDir, setSortDir] = useState(-1);
  const [pc, setPc] = usePersistedNumber("ahd_east_pc", 60);
  const [defcon] = useDefconState();

  const isHoG = role === "hog";
  const floor = WP_TREATY_FLOOR;
  const minPct = isHoG ? 0 : floor;
  const vm = WP_MEMBERS[0];
  const base = vm.commit;
  const clamp = (v: number) => Math.max(minPct, Math.min(100, v));
  const cur = clamp(override ?? base);
  const baseK = Math.round((vm.troops * base) / 100);
  const curK = Math.round((vm.troops * cur) / 100);
  const delta = cur - base;

  const coh = cohesionFrom(WP_BASE_COHESION, delta);
  const cohDelta = coh - WP_BASE_COHESION;
  useEffect(() => writePersistedNumber("ahd_east_cohesion", coh), [coh]);

  const getCommit = (m: Member) => (m.you ? cur : m.commit);
  const cp = combatPower(WP_MEMBERS, getCommit, coh);
  const upkeep = upkeepFor(curK);
  const upDelta = (curK - baseK) * UPKEEP_RATE;
  const pcCost = pcCostFor(delta, isHoG);
  const canIssue = delta !== 0 && pcCost <= pc;
  const kind = conseqKind(delta);
  const conseq =
    kind === "up"
      ? {
          t: `Committing ${curK - baseK}K above baseline — Pact cohesion ↑, combat power ↑, upkeep ↑.`,
          c: "#86d978",
        }
      : kind === "down"
        ? {
            t: `Diverting ${baseK - curK}K from the European command (to Afghanistan, the homeland) — satellites uneasy, cohesion ↓.`,
            c: "#ff7849",
          }
        : {
            t: "Soviet forces held at the baseline commitment to the joint command.",
            c: "#8a8a9a",
          };

  const setOv = (v: number) => {
    setOverride(clamp(v));
    setOrderMsg(null);
  };
  const issue = () => {
    if (delta === 0 || pcCost > pc) return;
    const actor = isHoG ? "General Secretary" : "Defence Minister";
    setPc(pc - pcCost);
    setOrderMsg(
      `${actor} order issued — Soviet Union commits ${curK}K (${cur}%) to joint command. −${pcCost} Party capital.`
    );
  };
  const advanceTurn = () => {
    setTurn(turn + 1);
    setPc(Math.min(PC_MAX, pc + PC_REGEN));
    setOrderMsg(`Turn ${turn + 1} — Stavka reconvenes; +${PC_REGEN} Party capital restored.`);
  };

  const comp = composition(WP_MEMBERS, getCommit);
  const totalCommK = cp.totalCommK;
  const maxCommitK = Math.max(1, ...WP_MEMBERS.map((m) => (m.troops * getCommit(m)) / 100));
  const agg = aggregates(WP_MEMBERS, getCommit);

  const rows = WP_MEMBERS.map((m) => ({
    ...m,
    committedK: (m.troops * getCommit(m)) / 100,
    commitEff: getCommit(m),
  }));
  rows.sort((a, b) =>
    sortKey === "name"
      ? a.name.localeCompare(b.name) * sortDir
      : (a.committedK - b.committedK) * sortDir
  );
  const nameArrow = sortKey === "name" ? (sortDir > 0 ? "▾" : "▴") : "";
  const commitArrow = sortKey === "commit" ? (sortDir > 0 ? "▾" : "▴") : "";
  const toggleSort = (k: "commit" | "name") => {
    if (sortKey === k) setSortDir(-sortDir);
    else {
      setSortKey(k);
      setSortDir(k === "name" ? 1 : -1);
    }
  };

  const stepBtn = {
    width: 30,
    height: 30,
    borderRadius: 7,
    border: "1px solid #3a2030",
    background: "#1d1320",
    color: "#e8e8ee",
    font: "600 16px system-ui",
    cursor: "pointer",
    flexShrink: 0,
  } as const;
  const presetBtn = {
    font: `600 8.5px ${mono}`,
    padding: "5px 10px",
    borderRadius: 6,
    border: "1px solid #3a2030",
    background: "#1a0f14",
    color: "#9595a4",
    cursor: "pointer",
  } as const;
  const roleBtn = (on: boolean) =>
    ({
      font: `600 8.5px ${mono}`,
      padding: "4px 10px",
      borderRadius: 6,
      cursor: "pointer",
      color: on ? "#f3f1ea" : "#8a5a66",
      background: on ? "rgba(220,38,38,.12)" : "transparent",
      border: `1px solid ${on ? "rgba(220,38,38,.4)" : "#3a2030"}`,
    }) as const;
  const statCard = {
    flex: 1,
    minWidth: 120,
    border: "1px solid #3a2030",
    background: "#16121a",
    borderRadius: 9,
    padding: "10px 12px",
  } as const;
  const defconNote = defcon <= 2 ? "MOBILIZING" : defcon >= 5 ? "fade out" : "HEIGHTENED";

  return (
    <div
      style={{
        padding: 26,
        fontFamily: "system-ui,-apple-system,sans-serif",
        color: "#e8e8ee",
        background: "radial-gradient(120% 80% at 50% 0%,#1d1316,#0b0b11 60%)",
      }}
    >
      <div
        style={{
          maxWidth: 1500,
          margin: "0 auto",
          background: "#14111a",
          border: "1px solid #3a2030",
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
            background:
              "repeating-linear-gradient(45deg,#2a1014,#2a1014 10px,#220d11 10px,#220d11 20px)",
            borderBottom: "1px solid #3a1620",
          }}
        >
          <span style={{ font: `600 10px ${mono}`, letterSpacing: ".2em", color: "#ef8a8a" }}>
            ☭ СОВ. СЕКРЕТНО · UNIFIED COMMAND — WARSAW PACT
          </span>
          <span style={{ font: `500 10px ${mono}`, letterSpacing: ".15em", color: "#8a5a66" }}>
            STAVKA · HIGH COMMAND OF THE JOINT FORCES
          </span>
        </div>

        {/* hero */}
        <div
          style={{
            position: "relative",
            padding: "22px 24px 20px",
            background: "linear-gradient(135deg,rgba(220,38,38,.12),rgba(20,17,26,0) 72%)",
            borderBottom: "1px solid #3a2030",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                width: 70,
                height: 70,
                flexShrink: 0,
                borderRadius: "50%",
                border: `2px solid ${ACCENT}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "radial-gradient(circle,rgba(220,38,38,.12),rgba(20,17,26,.1))",
                boxShadow: "0 0 22px rgba(220,38,38,.3)",
                font: `700 22px ${mono}`,
                color: "#ef8a8a",
              }}
            >
              ☭
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  margin: "0 0 4px",
                  font: `600 10px ${mono}`,
                  letterSpacing: ".22em",
                  color: "#8a5a66",
                }}
              >
                SECURITY ALLIANCE · EST. 1955
              </p>
              <h1
                style={{
                  margin: 0,
                  fontFamily: serif,
                  fontWeight: 700,
                  fontSize: 28,
                  lineHeight: 1.05,
                  color: "#f3f1ea",
                }}
              >
                Warsaw Treaty Organization
              </h1>
              <div style={{ display: "flex", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
                <span
                  style={{
                    font: `600 9px ${mono}`,
                    padding: "3px 9px",
                    borderRadius: 5,
                    background: "rgba(220,38,38,.12)",
                    border: "1px solid rgba(220,38,38,.4)",
                    color: "#ef8a8a",
                  }}
                >
                  UNIFIED COMMAND
                </span>
                <span
                  style={{
                    font: `600 9px ${mono}`,
                    padding: "3px 9px",
                    borderRadius: 5,
                    background: "rgba(255,120,73,.1)",
                    border: "1px solid #44260f",
                    color: "#ff7849",
                  }}
                >
                  ◆ DEFCON {defcon} · {defconNote}
                </span>
                <span
                  style={{
                    font: `600 9px ${mono}`,
                    padding: "3px 9px",
                    borderRadius: 5,
                    background: "#1d1320",
                    border: "1px solid #3a2030",
                    color: "#8a8a9a",
                  }}
                >
                  BREZHNEV DOCTRINE · ACTIVE
                </span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: "20px 24px 24px" }}>
          {/* commitment order */}
          <div
            style={{
              border: "1px solid rgba(220,38,38,.4)",
              background: "linear-gradient(180deg,rgba(220,38,38,.1),rgba(26,15,20,.35))",
              borderRadius: 12,
              padding: "15px 17px",
              marginBottom: 16,
            }}
          >
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{ font: `700 11px ${mono}`, letterSpacing: ".14em", color: "#ef8a8a" }}
                >
                  ⚙ FORCE COMMITMENT ORDER
                </span>
                <span style={{ font: `600 10px ${mono}`, color: "#8a8a9a" }}>
                  🚩 Soviet Union · joint command
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
                <span style={{ font: `600 8px ${mono}`, letterSpacing: ".1em", color: "#8a5a66" }}>
                  ACTING AS
                </span>
                <button
                  onClick={() => {
                    setRole("mod");
                    setOverride(null);
                    setOrderMsg(null);
                  }}
                  style={roleBtn(!isHoG)}
                >
                  DEFENCE MINISTER
                </button>
                <button
                  onClick={() => {
                    setRole("hog");
                    setOrderMsg(null);
                  }}
                  style={roleBtn(isHoG)}
                >
                  GENERAL SECRETARY
                </button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ minWidth: 150 }}>
                <div
                  style={{
                    fontFamily: serif,
                    fontWeight: 700,
                    fontSize: 28,
                    color: "#f3f1ea",
                    lineHeight: 1,
                  }}
                >
                  {curK}K{" "}
                  <span style={{ fontSize: 14, color: "#8a8a9a" }}>/ {fmtTroops(vm.troops)}</span>
                </div>
                <div style={{ font: `600 10px ${mono}`, color: "#ef8a8a", marginTop: 4 }}>
                  {cur}% TO JOINT COMMAND
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 300 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={() => setOv(cur - 5)} style={stepBtn}>
                    −
                  </button>
                  <input
                    type="range"
                    min={minPct}
                    max={100}
                    step={5}
                    value={cur}
                    onChange={(e) => setOv(+e.target.value)}
                    style={{ flex: 1, accentColor: ACCENT, cursor: "pointer", height: 6 }}
                  />
                  <button onClick={() => setOv(cur + 5)} style={stepBtn}>
                    +
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button onClick={() => setOv(minPct)} style={presetBtn}>
                    {isHoG ? "DIVERT ALL" : "FLOOR"}
                  </button>
                  <button onClick={() => setOv(50)} style={presetBtn}>
                    DIVERT 50%
                  </button>
                  <button onClick={() => setOv(100)} style={presetBtn}>
                    FULL 100%
                  </button>
                  <button
                    onClick={() => {
                      setOverride(null);
                      setOrderMsg(null);
                    }}
                    style={{
                      ...presetBtn,
                      marginLeft: "auto",
                      background: "transparent",
                      color: "#8a5a66",
                    }}
                  >
                    RESET
                  </button>
                </div>
              </div>
            </div>

            {/* stat cards */}
            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              <div style={statCard}>
                <div style={{ font: `600 8px ${mono}`, letterSpacing: ".08em", color: "#8a5a66" }}>
                  PACT COHESION
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 3 }}>
                  <span style={{ font: `700 18px ${mono}`, color: cohColor(coh) }}>{coh}%</span>
                  {delta !== 0 && (
                    <span style={{ font: `600 9px ${mono}`, color: cohColor(coh) }}>
                      {cohDelta > 0 ? "+" : ""}
                      {cohDelta}
                    </span>
                  )}
                </div>
              </div>
              <div style={statCard}>
                <div style={{ font: `600 8px ${mono}`, letterSpacing: ".08em", color: "#8a5a66" }}>
                  JOINT COMBAT POWER
                </div>
                <div style={{ marginTop: 3, font: `700 16px ${mono}`, color: "#e8e8ee" }}>
                  {fmtN(cp.effCP)}{" "}
                  <span style={{ fontSize: 8.5, color: "#8a8a9a" }}>
                    ×{cp.cohFactor.toFixed(2)} coh
                  </span>
                </div>
              </div>
              <div style={statCard}>
                <div style={{ font: `600 8px ${mono}`, letterSpacing: ".08em", color: "#8a5a66" }}>
                  UPKEEP
                </div>
                <div style={{ marginTop: 3, font: `700 14px ${mono}`, color: "#cfcfda" }}>
                  ₽{upkeep.toFixed(1)}B
                </div>
                {delta !== 0 && (
                  <div style={{ font: `600 8px ${mono}`, color: "#c98a52", marginTop: 1 }}>
                    {upDelta >= 0 ? "+" : "−"}₽{Math.abs(upDelta).toFixed(1)}B
                  </div>
                )}
              </div>
              <div style={statCard}>
                <div style={{ font: `600 8px ${mono}`, letterSpacing: ".08em", color: "#8a5a66" }}>
                  PARTY CAPITAL
                </div>
                <div style={{ marginTop: 3, font: `700 14px ${mono}`, color: "#d9bd6b" }}>
                  {pc} <span style={{ fontSize: 8, color: "#6f8a5a" }}>+{PC_REGEN}/turn</span>
                </div>
                <div style={{ font: `600 8px ${mono}`, color: "#8a8a9a", marginTop: 1 }}>
                  order cost {delta === 0 ? "no change" : `−${pcCost} PC`}
                </div>
              </div>
            </div>

            <div
              style={{ font: `500 10px ${mono}`, color: conseq.c, marginTop: 12, lineHeight: 1.45 }}
            >
              ▸ {conseq.t}
            </div>
            <div
              style={{ font: `500 9px ${mono}`, color: "#8a5a66", marginTop: 7, lineHeight: 1.4 }}
            >
              ⚖{" "}
              {isHoG
                ? `General Secretary — authority to divert forces below the ${floor}% commitment floor, at steeper political cost.`
                : `Defence Minister — bound by the ${floor}% commitment floor.`}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                onClick={issue}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  borderRadius: 8,
                  cursor: canIssue ? "pointer" : "default",
                  font: `600 11px ${mono}`,
                  color: canIssue ? "#f0a0a0" : "#54545f",
                  background: canIssue ? "rgba(220,38,38,.14)" : "#16121a",
                  border: `1px solid ${canIssue ? "rgba(220,38,38,.45)" : "#3a2030"}`,
                }}
              >
                ISSUE ORDER · {delta === 0 ? "no change" : `−${pcCost} PC`}
              </button>
              <button
                onClick={advanceTurn}
                style={{
                  font: `600 9px ${mono}`,
                  padding: "0 14px",
                  borderRadius: 8,
                  border: "1px solid #3a2030",
                  background: "#16121a",
                  color: "#9cc0a0",
                  cursor: "pointer",
                }}
              >
                ADVANCE TURN ▸ T{turn}
              </button>
            </div>
            {orderMsg && (
              <div
                style={{
                  marginTop: 11,
                  padding: "9px 12px",
                  borderRadius: 8,
                  background: "rgba(134,217,120,.08)",
                  border: "1px solid rgba(134,217,120,.3)",
                  font: `600 10px ${mono}`,
                  color: "#86d978",
                }}
              >
                ✔ {orderMsg}
              </div>
            )}
          </div>

          {/* aggregates */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6,1fr)",
              gap: 10,
              marginBottom: 16,
            }}
          >
            {agg.map((a) => (
              <div
                key={a.label}
                style={{
                  border: "1px solid #3a2030",
                  background: "#1a0f14",
                  borderRadius: 10,
                  padding: "12px 13px",
                }}
              >
                <div
                  style={{ font: `500 8.5px ${mono}`, letterSpacing: ".08em", color: "#8a5a66" }}
                >
                  {a.label}
                </div>
                <div
                  style={{
                    fontFamily: serif,
                    fontWeight: 700,
                    fontSize: 20,
                    color: "#f3f1ea",
                    marginTop: 3,
                  }}
                >
                  {a.value}
                </div>
                <div style={{ font: `500 8px ${mono}`, color: "#7a6a72", marginTop: 1 }}>
                  {a.sub}
                </div>
              </div>
            ))}
          </div>

          {/* composition */}
          <div
            style={{
              border: "1px solid #3a2030",
              background: "#1a0f14",
              borderRadius: 12,
              padding: "16px 18px",
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 11 }}>
              <span style={{ font: `600 10px ${mono}`, letterSpacing: ".14em", color: "#8a5a66" }}>
                JOINT COMMAND · FORCE COMPOSITION
              </span>
              <span style={{ font: `500 10px ${mono}`, color: "#8a8a9a" }}>
                {Math.round(totalCommK)}K committed
              </span>
            </div>
            <div
              style={{
                display: "flex",
                height: 26,
                borderRadius: 7,
                overflow: "hidden",
                border: "1px solid #2a1620",
              }}
            >
              {comp.map((c, i) => (
                <div
                  key={c.short}
                  title={`${c.short} — ${Math.round(c.committedK)}K committed`}
                  style={{
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    width: `${c.pctNum}%`,
                    background: shadeOf(ACCENT, i, comp.length, "#1a0f14"),
                    borderRight: "1px solid rgba(0,0,0,.3)",
                  }}
                >
                  <span style={{ font: `700 9px ${mono}`, color: "rgba(255,255,255,.85)" }}>
                    {c.short}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 11 }}>
              {comp.map((c, i) => (
                <span
                  key={c.short}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    font: `500 9.5px ${mono}`,
                    color: "#8a8a9a",
                  }}
                >
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 2,
                      background: shadeOf(ACCENT, i, comp.length, "#1a0f14"),
                    }}
                  />
                  {c.flag} {c.short} · {Math.round(c.committedK)}K
                </span>
              ))}
            </div>
          </div>

          {/* member table */}
          <div
            style={{
              border: "1px solid #3a2030",
              background: "#14111a",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.7fr 1.5fr 0.7fr 0.8fr 0.8fr 0.7fr",
                padding: "10px 16px",
                font: `600 8.5px ${mono}`,
                letterSpacing: ".06em",
                color: "#8a5a66",
                borderBottom: "1px solid #3a2030",
                background: "#1a0f14",
              }}
            >
              <span onClick={() => toggleSort("name")} style={{ cursor: "pointer" }}>
                MEMBER {nameArrow}
              </span>
              <span onClick={() => toggleSort("commit")} style={{ cursor: "pointer" }}>
                COMMITTED TO COMMAND {commitArrow}
              </span>
              <span style={{ textAlign: "right" }}>DIV</span>
              <span style={{ textAlign: "right" }}>AIRCRAFT</span>
              <span style={{ textAlign: "right" }}>TANKS</span>
              <span style={{ textAlign: "right" }}>WARHEADS</span>
            </div>
            {rows.map((r, i) => (
              <div
                key={r.short + i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.7fr 1.5fr 0.7fr 0.8fr 0.8fr 0.7fr",
                  alignItems: "center",
                  padding: "10px 16px",
                  borderBottom: "1px solid #1e1018",
                  background: r.you ? "rgba(220,38,38,.07)" : i % 2 ? "#1a0f14" : "transparent",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    font: "600 12px system-ui",
                    color: "#e8e8ee",
                  }}
                >
                  <span style={{ fontSize: 15 }}>{r.flag}</span>
                  <span>{r.name}</span>
                  {r.you && (
                    <span
                      style={{ font: `600 8px ${mono}`, color: "#ef8a8a", letterSpacing: ".06em" }}
                    >
                      ◂ YOU
                    </span>
                  )}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <div
                    style={{
                      flex: 1,
                      position: "relative",
                      height: 11,
                      borderRadius: 6,
                      background: "#0a0a12",
                      border: "1px solid #2a1620",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        background: commitColor(r.commitEff),
                        width: `${Math.round((r.committedK / maxCommitK) * 100)}%`,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      width: 96,
                      textAlign: "right",
                      font: `600 9.5px ${mono}`,
                      color: "#cfcfda",
                    }}
                  >
                    {Math.round(r.committedK)}K · {r.commitEff}%
                  </span>
                </div>
                <span style={{ textAlign: "right", font: `500 10px ${mono}`, color: "#9595a4" }}>
                  {r.div || "—"}
                </span>
                <span style={{ textAlign: "right", font: `500 10px ${mono}`, color: "#9595a4" }}>
                  {r.air ? fmtN(r.air) : "—"}
                </span>
                <span style={{ textAlign: "right", font: `500 10px ${mono}`, color: "#9595a4" }}>
                  {r.tanks ? fmtN(r.tanks) : "—"}
                </span>
                <span
                  style={{
                    textAlign: "right",
                    font: `500 10px ${mono}`,
                    color: r.warheads ? "#ff9d7a" : "#54545f",
                  }}
                >
                  {r.warheads ? fmtN(r.warheads) : "—"}
                </span>
              </div>
            ))}
            <div style={{ padding: "9px 16px", font: `500 9px ${mono}`, color: "#8a5a66" }}>
              bar = personnel committed to the joint command · % of that nation&apos;s standing army
              · Romania the perennial holdout
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

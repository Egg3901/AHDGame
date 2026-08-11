"use client";

import { useEffect, useState } from "react";
import { usePersistedNumber, writePersistedNumber } from "./persisted";
import {
  PC_MAX,
  PC_REGEN,
  UPKEEP_RATE,
  cohesionFrom,
  commitColor,
  composition,
  fmtN,
  fmtTroops,
  pcCostFor,
  upkeepFor,
  type Member,
} from "./orgForces";
import { ORGS, ORG_ORDER } from "./orgs";
import { OrgsForcesTab, type Reaction, type ViewerCommit } from "./OrgsForcesTab";

const mono = "'IBM Plex Mono',monospace";
const serif = "Lora,Georgia,serif";

const TABS: [string, string][] = [
  ["overview", "OVERVIEW"],
  ["forces", "MILITARY FORCES"],
  ["members", "MEMBERS"],
  ["resolutions", "RESOLUTIONS"],
];

/** International Organizations (West) — the 5-org diplomatic directory. */
export function OrgsBoard() {
  const [orgId, setOrgId] = useState("nato");
  const [tab, setTab] = useState("overview");
  const [sortKey, setSortKey] = useState<"commit" | "name">("commit");
  const [sortDir, setSortDir] = useState(-1);
  const [openMember, setOpenMember] = useState<string | null>(null);
  const [votes, setVotes] = useState<Record<string, string>>({});
  const [commitOverride, setCommitOverride] = useState<Record<string, number>>({});
  const [orderMsg, setOrderMsg] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [role, setRole] = useState<"mod" | "hog">("mod");
  const [turn, setTurn] = useState(1);
  const [pc, setPc] = usePersistedNumber("ahd_west_pc", 62);

  const org = ORGS[orgId];
  const viewerShort = org.viewer ?? "";
  const okey = orgId + ":" + viewerShort;
  const override = commitOverride[okey];
  const isHoG = role === "hog";
  const floor = org.treatyFloor ?? 0;
  const minPct = isHoG ? 0 : floor;
  const vm = org.members.find((m) => m.short === viewerShort);
  const base = vm?.commit ?? 0;
  const cur = vm ? Math.max(minPct, Math.min(100, override ?? base)) : 0;
  const delta = cur - base;
  const getCommit = (m: Member) => (m.short === viewerShort && override != null ? cur : m.commit);
  const coh = org.hasMilitary && vm ? cohesionFrom(org.baseCohesion ?? 0, delta) : 0;

  // The NATO commitment slider is the canonical setter of Western bloc cohesion.
  useEffect(() => {
    if (orgId === "nato" && vm) writePersistedNumber("ahd_west_cohesion", coh);
  }, [coh, orgId, vm]);

  const selectOrg = (id: string) => {
    setOrgId(id);
    setTab("overview");
    setOpenMember(null);
  };
  const toggleSort = (k: "commit" | "name") => {
    if (sortKey === k) setSortDir(-sortDir);
    else {
      setSortKey(k);
      setSortDir(k === "name" ? 1 : -1);
    }
  };

  // ── viewer-commitment context for the Forces tab ──
  let vc: ViewerCommit | null = null;
  if (org.hasMilitary && vm) {
    const curK = Math.round((vm.troops * cur) / 100);
    const baseK = Math.round((vm.troops * base) / 100);
    const pcCost = pcCostFor(delta, isHoG);
    const cohDelta = coh - (org.baseCohesion ?? 0);
    const hub = org.short === "NATO" ? "SHAPE" : "STAVKA";
    const seeded: Reaction[] = (org.vReact ?? []).map(([who, color, text]) => ({
      who,
      color,
      text,
    }));
    const setOv = (v: number) => {
      setCommitOverride((m) => ({ ...m, [okey]: Math.max(minPct, Math.min(100, v)) }));
      setOrderMsg(null);
    };
    vc = {
      vm,
      cur,
      base,
      delta,
      minPct,
      floor,
      isHoG,
      coh,
      cohDelta,
      getCommit,
      pc,
      pcCost,
      canIssue: delta !== 0 && pcCost <= pc,
      curK,
      baseK,
      upkeep: upkeepFor(curK),
      upDelta: (curK - baseK) * UPKEEP_RATE,
      budget: org.vBudget ?? 0,
      reactions: [...(reactions[okey] ?? []), ...seeded].slice(0, 4),
      turn,
      orderMsg,
      setOv,
      setMoD: () => {
        setRole("mod");
        setCommitOverride({});
        setOrderMsg(null);
      },
      setHoG: () => {
        setRole("hog");
        setOrderMsg(null);
      },
      issue: () => {
        if (delta === 0 || pcCost > pc) return;
        const actor = isHoG ? "Head of Government" : "Min. of Defense";
        const r: Reaction =
          delta < 0
            ? {
                who: hub,
                color: "#ff7849",
                text: `${vm.name} withholds ${baseK - curK}K — formal protest lodged. Cohesion ${cohDelta}.`,
              }
            : {
                who: hub,
                color: "#86d978",
                text: `${vm.name} reinforces the line, +${curK - baseK}K. Cohesion +${cohDelta}.`,
              };
        setPc(Math.max(0, pc - pcCost));
        setReactions((m) => ({ ...m, [okey]: [r, ...(m[okey] ?? [])].slice(0, 3) }));
        setOrderMsg(
          `${actor} order issued — ${vm.name} commits ${curK}K (${cur}%). −${pcCost} political capital.`
        );
      },
      advanceTurn: () => {
        const nt = turn + 1;
        const tr: Reaction = {
          who: "STAFF",
          color: "#6fa8dc",
          text: `Turn ${nt} — staff reconvene; +${PC_REGEN} political capital restored.`,
        };
        setTurn(nt);
        setPc(Math.min(PC_MAX, pc + PC_REGEN));
        setReactions((m) => ({ ...m, [okey]: [tr, ...(m[okey] ?? [])].slice(0, 3) }));
        setOrderMsg(null);
      },
    };
  }

  // ── overview derived ──
  const totTroops = org.members.reduce((a, b) => a + b.troops, 0);
  const totTanks = org.members.reduce((a, b) => a + b.tanks, 0);
  const totWar = org.members.reduce((a, b) => a + b.warheads, 0);
  const totalCommK = org.members.reduce((a, b) => a + (b.troops * getCommit(b)) / 100, 0);
  const avgCommit = org.members.length
    ? Math.round(org.members.reduce((a, b) => a + b.commit, 0) / org.members.length)
    : 0;
  const maxCommitK = Math.max(1, ...org.members.map((m) => (m.troops * getCommit(m)) / 100));
  const highlights = org.hasMilitary
    ? [
        {
          label: "ACTIVE PERSONNEL",
          value: fmtTroops(totTroops),
          sub: "standing armies",
          subColor: "#7a7a8c",
        },
        {
          label: "COMMITTED TO COMMAND",
          value: fmtTroops(Math.round(totalCommK)),
          sub: `${avgCommit}% avg pledged`,
          subColor: "#86d978",
        },
        { label: "MAIN BATTLE TANKS", value: fmtN(totTanks), sub: "combined", subColor: "#7a7a8c" },
        {
          label: "NUCLEAR WARHEADS",
          value: fmtN(totWar),
          sub: "strategic + tactical",
          subColor: "#ff7849",
        },
      ]
    : [
        { label: "MEMBER STATES", value: org.stats[0][1], sub: "sovereign", subColor: "#7a7a8c" },
        { label: "COMBINED GDP", value: org.stats[1][1], sub: "world share", subColor: "#7a7a8c" },
        { label: "JOINT FORCES", value: "NONE", sub: "no command", subColor: "#7a7a8c" },
        { label: "CATEGORY", value: org.cat, sub: org.catLabel.toLowerCase(), subColor: "#d9bd6b" },
      ];
  const topContributors = composition(org.members, getCommit)
    .slice(0, 3)
    .map((c) => ({
      flag: c.flag,
      name: org.members.find((m) => m.short === c.short)?.name ?? c.short,
      troops: Math.round(c.committedK) + "K",
      barPct: Math.round((c.committedK / maxCommitK) * 100) + "%",
    }));

  const voteKey = orgId + "-0";

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 26,
        fontFamily: "system-ui,-apple-system,sans-serif",
        color: "#e8e8ee",
        background: "radial-gradient(120% 80% at 50% 0%,#15151d,#0b0b11 60%)",
      }}
    >
      <div
        style={{
          maxWidth: 1700,
          margin: "0 auto",
          display: "flex",
          gap: 18,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        {/* directory rail */}
        <div
          style={{
            width: 268,
            flexShrink: 0,
            background: "#14141c",
            border: "1px solid #2a2a3d",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "13px 16px", borderBottom: "1px solid #2a2a3d" }}>
            <p
              style={{
                margin: 0,
                font: `600 9px ${mono}`,
                letterSpacing: ".22em",
                color: "#6b6b7a",
              }}
            >
              DIPLOMACY
            </p>
            <h2
              style={{
                margin: "3px 0 0",
                fontFamily: serif,
                fontWeight: 700,
                fontSize: 17,
                color: "#f3f1ea",
              }}
            >
              Organizations
            </h2>
          </div>
          <div style={{ padding: 8 }}>
            {ORG_ORDER.map((id) => {
              const o = ORGS[id];
              const sel = id === orgId;
              return (
                <div
                  key={id}
                  onClick={() => selectOrg(id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    padding: "10px 11px",
                    borderRadius: 9,
                    cursor: "pointer",
                    marginBottom: 3,
                    border: `1px solid ${sel ? o.acBd : "transparent"}`,
                    background: sel ? o.acBg : "transparent",
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      flexShrink: 0,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: `1.5px solid ${o.ac}`,
                      background: o.sealBg,
                      font: `700 8px ${mono}`,
                      color: o.ac,
                    }}
                  >
                    {o.seal}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        font: "600 12.5px system-ui",
                        color: "#f3f1ea",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {o.short}
                    </div>
                    <div style={{ font: `500 9px ${mono}`, color: "#7a7a8c", marginTop: 1 }}>
                      {o.cat} · {o.stats[0][1]} members
                    </div>
                  </div>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: o.postureColor,
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div
            style={{
              padding: "11px 16px",
              borderTop: "1px solid #2a2a3d",
              font: `500 9px ${mono}`,
              color: "#54545f",
              lineHeight: 1.5,
            }}
          >
            ● security · ◆ economic · ○ diplomatic — dot shows alert posture
          </div>
        </div>

        {/* main */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            background: "#14141c",
            border: "1px solid #2a2a3d",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 18px 50px -14px rgba(0,0,0,.7)",
          }}
        >
          {/* hero */}
          <div
            style={{
              position: "relative",
              padding: "22px 26px 20px",
              background: `linear-gradient(135deg,${org.acBg},rgba(20,20,28,0) 72%)`,
              borderBottom: "1px solid #2a2a3d",
            }}
          >
            <div
              style={{
                font: `500 10px ${mono}`,
                letterSpacing: ".14em",
                color: "#6b6b7a",
                marginBottom: 12,
              }}
            >
              ◂ WORLD · DIPLOMACY
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <div
                style={{
                  width: 70,
                  height: 70,
                  flexShrink: 0,
                  borderRadius: "50%",
                  border: `2px solid ${org.ac}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: `radial-gradient(circle,${org.acBg},rgba(20,20,28,.1))`,
                  boxShadow: `0 0 22px ${org.acSoft}`,
                  font: `700 13px ${mono}`,
                  color: org.ac,
                }}
              >
                {org.sealBig}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1
                  style={{
                    margin: 0,
                    fontFamily: serif,
                    fontWeight: 700,
                    fontSize: 27,
                    lineHeight: 1.08,
                    color: "#f3f1ea",
                  }}
                >
                  {org.name}
                </h1>
                <div style={{ display: "flex", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
                  <span
                    style={{
                      font: `600 9px ${mono}`,
                      padding: "3px 9px",
                      borderRadius: 5,
                      background: org.acBg,
                      border: `1px solid ${org.acBd}`,
                      color: org.ac,
                    }}
                  >
                    {org.catLabel}
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
                    ◆ {org.posture}
                  </span>
                  <span
                    style={{
                      font: `600 9px ${mono}`,
                      padding: "3px 9px",
                      borderRadius: 5,
                      background: "#1d1d2a",
                      border: "1px solid #2a2a3d",
                      color: "#8a8a9a",
                    }}
                  >
                    EST. {org.founded}
                  </span>
                </div>
              </div>
            </div>
            <p
              style={{
                margin: "14px 0 0",
                fontSize: 12.5,
                lineHeight: 1.55,
                color: "#9595a4",
                maxWidth: 680,
              }}
            >
              {org.desc}
            </p>
          </div>

          {/* stat strip */}
          <div style={{ display: "flex", borderBottom: "1px solid #2a2a3d", flexWrap: "wrap" }}>
            {org.stats.map((s, i) => (
              <div
                key={s[0]}
                style={{
                  flex: 1,
                  minWidth: 150,
                  padding: "11px 18px",
                  borderRight: i < org.stats.length - 1 ? "1px solid #2a2a3d" : "none",
                }}
              >
                <div style={{ font: `500 9px ${mono}`, letterSpacing: ".12em", color: "#6b6b7a" }}>
                  {s[0]}
                </div>
                <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 20, color: s[2] }}>
                  {s[1]}
                </div>
              </div>
            ))}
          </div>

          {/* tabs */}
          <div
            style={{
              display: "flex",
              gap: 2,
              padding: "10px 18px 0",
              borderBottom: "1px solid #2a2a3d",
              flexWrap: "wrap",
            }}
          >
            {TABS.map(([id, label]) => {
              const on = tab === id;
              return (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  style={{
                    position: "relative",
                    padding: "9px 16px",
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    font: `600 11px ${mono}`,
                    letterSpacing: ".06em",
                    color: on ? "#f3f1ea" : "#6b6b7a",
                    borderBottom: `2px solid ${on ? org.ac : "transparent"}`,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div style={{ padding: "20px 26px 26px" }}>
            {tab === "overview" && (
              <div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4,1fr)",
                    gap: 12,
                    marginBottom: 20,
                  }}
                >
                  {highlights.map((h) => (
                    <div
                      key={h.label}
                      style={{
                        border: "1px solid #2a2a3d",
                        background: "#1a1a25",
                        borderRadius: 11,
                        padding: "13px 15px",
                      }}
                    >
                      <div
                        style={{ font: `500 9px ${mono}`, letterSpacing: ".1em", color: "#6b6b7a" }}
                      >
                        {h.label}
                      </div>
                      <div
                        style={{
                          fontFamily: serif,
                          fontWeight: 700,
                          fontSize: 23,
                          color: "#f3f1ea",
                          marginTop: 4,
                        }}
                      >
                        {h.value}
                      </div>
                      <div style={{ font: `500 9px ${mono}`, color: h.subColor, marginTop: 2 }}>
                        {h.sub}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
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
                        font: `600 10px ${mono}`,
                        letterSpacing: ".14em",
                        color: "#6b6b7a",
                        marginBottom: 13,
                      }}
                    >
                      TOP FORCE CONTRIBUTORS
                    </div>
                    {topContributors.map((c) => (
                      <div
                        key={c.name}
                        style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 11 }}
                      >
                        <span style={{ fontSize: 17 }}>{c.flag}</span>
                        <span
                          style={{ width: 104, font: "600 11.5px system-ui", color: "#e8e8ee" }}
                        >
                          {c.name}
                        </span>
                        <div
                          style={{
                            flex: 1,
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
                              background: `linear-gradient(90deg,${org.acSoft},${org.ac})`,
                              width: c.barPct,
                            }}
                          />
                        </div>
                        <span
                          style={{
                            width: 88,
                            textAlign: "right",
                            font: `600 10px ${mono}`,
                            color: "#e8e8ee",
                          }}
                        >
                          {c.troops}
                        </span>
                      </div>
                    ))}
                    <div style={{ font: `500 9px ${mono}`, color: "#6b6b7a", marginTop: 4 }}>
                      active personnel committed to joint command
                    </div>
                  </div>
                  <div
                    style={{
                      border: `1px solid ${org.acBd}`,
                      background: org.acBg,
                      borderRadius: 12,
                      padding: "16px 18px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "start",
                      }}
                    >
                      <div style={{ font: "600 13px system-ui", color: "#f3f1ea" }}>
                        {org.resTitle}
                      </div>
                      <span
                        style={{
                          font: `600 9px ${mono}`,
                          padding: "3px 8px",
                          borderRadius: 5,
                          background: "rgba(234,179,8,.1)",
                          border: "1px solid rgba(234,179,8,.3)",
                          color: "#eab308",
                          whiteSpace: "nowrap",
                        }}
                      >
                        VOTING
                      </span>
                    </div>
                    <p
                      style={{
                        margin: "9px 0 0",
                        font: `500 11px ${mono}`,
                        color: "#9595a4",
                        lineHeight: 1.5,
                      }}
                    >
                      {org.resBlurb}
                    </p>
                    <button
                      onClick={() => setTab("resolutions")}
                      style={{
                        marginTop: 14,
                        width: "100%",
                        padding: "9px 0",
                        borderRadius: 8,
                        border: `1px solid ${org.acBd}`,
                        background: org.acBg,
                        color: org.ac,
                        font: `600 10.5px ${mono}`,
                        cursor: "pointer",
                      }}
                    >
                      OPEN RESOLUTIONS ▸
                    </button>
                  </div>
                </div>
              </div>
            )}

            {tab === "forces" &&
              (vc ? (
                <OrgsForcesTab
                  org={org}
                  vc={vc}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                />
              ) : (
                <div
                  style={{
                    border: "1px dashed #2a2a3d",
                    background: "#11111a",
                    borderRadius: 12,
                    padding: 40,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 26, marginBottom: 8 }}>🕊</div>
                  <div style={{ font: "600 14px system-ui", color: "#cfcfda" }}>
                    No joint military command
                  </div>
                  <p
                    style={{
                      margin: "6px auto 0",
                      maxWidth: 380,
                      font: `500 11px ${mono}`,
                      color: "#7a7a8c",
                      lineHeight: 1.5,
                    }}
                  >
                    {org.noForceNote}
                  </p>
                </div>
              ))}

            {tab === "members" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
                {org.members.map((m) => {
                  const open = openMember === m.short;
                  const detail = org.hasMilitary
                    ? [
                        ["PERSONNEL", fmtTroops(m.troops)],
                        ["COMMITTED", Math.round((m.troops * getCommit(m)) / 100) + "K"],
                        ["DIVISIONS", String(m.div)],
                        ["AIRCRAFT", m.air ? fmtN(m.air) : "—"],
                        ["TANKS", m.tanks ? fmtN(m.tanks) : "—"],
                        ["DEFENSE %GDP", (m.pct ?? 0) + "%"],
                      ]
                    : [
                        ["STATUS", m.status ?? ""],
                        ["JOINED", String(m.year ?? "")],
                        ["FORCES", "sovereign"],
                      ];
                  return (
                    <div
                      key={m.short}
                      onClick={() => setOpenMember(open ? null : m.short)}
                      style={{
                        cursor: "pointer",
                        border: `1px solid ${open ? org.acBd : "#2a2a3d"}`,
                        background: open ? org.acBg : "#1a1a25",
                        borderRadius: 11,
                        padding: "13px 15px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                        <span style={{ fontSize: 20 }}>{m.flag}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ font: "600 13px system-ui", color: "#f3f1ea" }}>
                            {m.name}
                          </div>
                          <div style={{ font: `500 9px ${mono}`, color: "#7a7a8c", marginTop: 1 }}>
                            {m.status} · joined {m.year}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div
                            style={{
                              fontFamily: serif,
                              fontWeight: 700,
                              fontSize: 16,
                              color: org.hasMilitary ? commitColor(getCommit(m)) : "#7a7a8c",
                            }}
                          >
                            {org.hasMilitary ? getCommit(m) + "%" : "—"}
                          </div>
                          <div style={{ font: `500 8px ${mono}`, color: "#6b6b7a" }}>COMMITTED</div>
                        </div>
                      </div>
                      {open && (
                        <div
                          style={{
                            marginTop: 12,
                            paddingTop: 11,
                            borderTop: "1px solid #2a2a3d",
                            display: "grid",
                            gridTemplateColumns: "repeat(3,1fr)",
                            gap: 9,
                          }}
                        >
                          {detail.map(([k, v]) => (
                            <div key={k}>
                              <div style={{ font: `500 8px ${mono}`, color: "#6b6b7a" }}>{k}</div>
                              <div
                                style={{ font: `600 12px ${mono}`, color: "#e8e8ee", marginTop: 2 }}
                              >
                                {v}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {tab === "resolutions" && (
              <div
                style={{
                  border: "1px solid #2a2a3d",
                  background: "#1a1a25",
                  borderRadius: 12,
                  padding: "16px 18px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "start",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ font: "600 15px system-ui", color: "#f3f1ea" }}>
                      {org.resTitle}
                    </div>
                    <div style={{ font: `500 10px ${mono}`, color: "#7a7a8c", marginTop: 3 }}>
                      tabled this turn · voting window 3 turns
                    </div>
                  </div>
                  <span
                    style={{
                      font: `600 9px ${mono}`,
                      padding: "3px 8px",
                      borderRadius: 5,
                      background: "rgba(234,179,8,.1)",
                      border: "1px solid rgba(234,179,8,.3)",
                      color: "#eab308",
                      whiteSpace: "nowrap",
                    }}
                  >
                    VOTING
                  </span>
                </div>
                <p
                  style={{
                    margin: "10px 0 0",
                    font: `500 11px ${mono}`,
                    color: "#9595a4",
                    lineHeight: 1.5,
                  }}
                >
                  {org.resBlurb}
                </p>
                <div style={{ marginTop: 13 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      font: `500 10px ${mono}`,
                      color: "#7a7a8c",
                      marginBottom: 5,
                    }}
                  >
                    <span>11 / 14 yea · 0 nay</span>
                    <span>2/3 turns</span>
                  </div>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 5,
                      background: "#0a0a12",
                      border: "1px solid #23232f",
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ height: "100%", background: "#22c55e", width: "79%" }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 13 }}>
                  <button
                    onClick={() => setVotes((v) => ({ ...v, [voteKey]: "YEA" }))}
                    style={{
                      flex: 1,
                      padding: "9px 0",
                      borderRadius: 8,
                      cursor: "pointer",
                      font: `600 11px ${mono}`,
                      color: "#86d978",
                      background: "rgba(34,197,94,.12)",
                      border: "1px solid rgba(34,197,94,.4)",
                    }}
                  >
                    ▲ YEA
                  </button>
                  <button
                    onClick={() => setVotes((v) => ({ ...v, [voteKey]: "NAY" }))}
                    style={{
                      flex: 1,
                      padding: "9px 0",
                      borderRadius: 8,
                      cursor: "pointer",
                      font: `600 11px ${mono}`,
                      color: "#ef8a8a",
                      background: "rgba(239,68,68,.1)",
                      border: "1px solid rgba(239,68,68,.4)",
                    }}
                  >
                    ▼ NAY
                  </button>
                  <button
                    onClick={() => setVotes((v) => ({ ...v, [voteKey]: "ABSTAIN" }))}
                    style={{
                      flex: 1,
                      padding: "9px 0",
                      borderRadius: 8,
                      cursor: "pointer",
                      font: `600 11px ${mono}`,
                      color: "#8a8a9a",
                      background: "#14141c",
                      border: "1px solid #2a2a3d",
                    }}
                  >
                    ABSTAIN
                  </button>
                </div>
                {votes[voteKey] && (
                  <div style={{ marginTop: 10, font: `600 10px ${mono}`, color: "#86d978" }}>
                    ✔ Your delegation voted {votes[voteKey]} — recorded for {org.short}.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

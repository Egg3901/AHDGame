import {
  PC_REGEN,
  aggregates,
  cohColor,
  combatPower,
  commitColor,
  composition,
  fmtN,
  fmtTroops,
  shadeOf,
  type Member,
} from "./orgForces";
import type { Org } from "./orgs";

const mono = "'IBM Plex Mono',monospace";
const serif = "Lora,Georgia,serif";

export type Reaction = { who: string; color: string; text: string };

/** The fully-computed viewer-commitment context for the Forces tab. */
export type ViewerCommit = {
  vm: Member;
  cur: number;
  base: number;
  delta: number;
  minPct: number;
  floor: number;
  isHoG: boolean;
  coh: number;
  cohDelta: number;
  getCommit: (m: Member) => number;
  pc: number;
  pcCost: number;
  canIssue: boolean;
  curK: number;
  baseK: number;
  upkeep: number;
  upDelta: number;
  budget: number;
  reactions: Reaction[];
  turn: number;
  orderMsg: string | null;
  setOv: (v: number) => void;
  setMoD: () => void;
  setHoG: () => void;
  issue: () => void;
  advanceTurn: () => void;
};

/** Military Forces tab — joint-command commitment, composition, and member roster. */
export function OrgsForcesTab({
  org,
  vc,
  sortKey,
  sortDir,
  onSort,
}: {
  org: Org;
  vc: ViewerCommit;
  sortKey: "commit" | "name";
  sortDir: number;
  onSort: (k: "commit" | "name") => void;
}) {
  const cp = combatPower(org.members, vc.getCommit, vc.coh);
  const comp = composition(org.members, vc.getCommit);
  const agg = aggregates(org.members, vc.getCommit);
  const maxCommitK = Math.max(1, ...org.members.map((m) => (m.troops * vc.getCommit(m)) / 100));
  const rows = org.members.map((m) => ({
    ...m,
    committedK: (m.troops * vc.getCommit(m)) / 100,
    commitEff: vc.getCommit(m),
  }));
  rows.sort((a, b) =>
    sortKey === "name"
      ? a.name.localeCompare(b.name) * sortDir
      : (a.committedK - b.committedK) * sortDir
  );
  const nameArrow = sortKey === "name" ? (sortDir > 0 ? "▾" : "▴") : "";
  const commitArrow = sortKey === "commit" ? (sortDir > 0 ? "▾" : "▴") : "";

  const conseq =
    vc.delta > 0
      ? {
          t: `Committing ${vc.curK - vc.baseK}K above baseline — cohesion ↑, combat power ↑, upkeep ↑.`,
          c: "#86d978",
        }
      : vc.delta < 0
        ? {
            t: `Withholding ${vc.baseK - vc.curK}K from joint command — allies uneasy, cohesion ↓, combat power ↓.`,
            c: "#ff7849",
          }
        : { t: "Forces held at the treaty baseline commitment.", c: "#8a8a9a" };
  const pcCostLabel = vc.delta === 0 ? "no change" : `−${vc.pcCost} PC`;

  const stepBtn = {
    width: 30,
    height: 30,
    borderRadius: 7,
    border: "1px solid #2a2a3d",
    background: "#1d1d2a",
    color: "#e8e8ee",
    font: "600 16px system-ui",
    cursor: "pointer",
    flexShrink: 0,
  } as const;
  const presetBtn = {
    font: `600 8.5px ${mono}`,
    padding: "5px 10px",
    borderRadius: 6,
    border: "1px solid #2a2a3d",
    background: "#16161f",
    color: "#9595a4",
    cursor: "pointer",
  } as const;
  const roleBtn = (on: boolean) =>
    ({
      font: `600 8.5px ${mono}`,
      padding: "4px 10px",
      borderRadius: 6,
      cursor: "pointer",
      color: on ? "#f3f1ea" : "#7a7a8c",
      background: on ? org.acBg : "transparent",
      border: `1px solid ${on ? org.acBd : "#2a2a3d"}`,
    }) as const;

  return (
    <div>
      {/* commitment order */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            border: `1px solid ${org.acBd}`,
            background: `linear-gradient(180deg,${org.acBg},rgba(17,17,26,.35))`,
            borderRadius: 12,
            padding: "15px 17px",
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
              <span style={{ font: `700 11px ${mono}`, letterSpacing: ".14em", color: org.ac }}>
                ⚙ FORCE COMMITMENT ORDER
              </span>
              <span style={{ font: `600 10px ${mono}`, color: "#8a8a9a" }}>
                {vc.vm.flag} {vc.vm.name}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
              <span style={{ font: `600 8px ${mono}`, letterSpacing: ".1em", color: "#6b6b7a" }}>
                ACTING AS
              </span>
              <button onClick={vc.setMoD} style={roleBtn(!vc.isHoG)}>
                MIN. OF DEFENSE
              </button>
              <button onClick={vc.setHoG} style={roleBtn(vc.isHoG)}>
                HEAD OF GOV&apos;T
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            {/* left: control */}
            <div style={{ flex: 1, minWidth: 320 }}>
              <div
                style={{
                  fontFamily: serif,
                  fontWeight: 700,
                  fontSize: 28,
                  color: "#f3f1ea",
                  lineHeight: 1,
                }}
              >
                {vc.curK}K{" "}
                <span style={{ fontSize: 14, color: "#8a8a9a" }}>/ {fmtTroops(vc.vm.troops)}</span>
              </div>
              <div
                style={{ font: `600 10px ${mono}`, color: org.ac, marginTop: 4, marginBottom: 12 }}
              >
                {vc.cur}% TO JOINT COMMAND
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={() => vc.setOv(vc.cur - 5)} style={stepBtn}>
                  −
                </button>
                <input
                  type="range"
                  min={vc.minPct}
                  max={100}
                  step={5}
                  value={vc.cur}
                  onChange={(e) => vc.setOv(+e.target.value)}
                  style={{ flex: 1, accentColor: org.ac, cursor: "pointer", height: 6 }}
                />
                <button onClick={() => vc.setOv(vc.cur + 5)} style={stepBtn}>
                  +
                </button>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button onClick={() => vc.setOv(vc.minPct)} style={presetBtn}>
                  {vc.isHoG ? "WITHHOLD" : "TREATY MIN"}
                </button>
                <button onClick={() => vc.setOv(50)} style={presetBtn}>
                  TREATY 50%
                </button>
                <button onClick={() => vc.setOv(100)} style={presetBtn}>
                  FULL 100%
                </button>
                <button
                  onClick={() => vc.setOv(vc.base)}
                  style={{
                    ...presetBtn,
                    marginLeft: "auto",
                    background: "transparent",
                    color: "#6b6b7a",
                  }}
                >
                  RESET
                </button>
              </div>
              <div
                style={{
                  font: `500 10px ${mono}`,
                  color: conseq.c,
                  marginTop: 12,
                  lineHeight: 1.45,
                }}
              >
                ▸ {conseq.t}
              </div>
              <div
                style={{ font: `500 9px ${mono}`, color: "#6b6b7a", marginTop: 7, lineHeight: 1.4 }}
              >
                ⚖{" "}
                {vc.isHoG
                  ? `Head of Government — authority to withdraw below the ${vc.floor}% treaty floor, at steeper political cost.`
                  : `Minister of Defense — bound by the ${vc.floor}% treaty floor.`}
              </div>
            </div>
            {/* right: cohesion + resources + issue */}
            <div
              style={{
                width: 300,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                gap: 11,
              }}
            >
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
                    style={{ font: `600 9px ${mono}`, letterSpacing: ".12em", color: "#6b6b7a" }}
                  >
                    ALLIANCE COHESION
                  </span>
                  <span style={{ font: `700 14px ${mono}`, color: cohColor(vc.coh) }}>
                    {vc.coh}
                    <span style={{ fontSize: 9, color: "#6b6b7a" }}>/100</span>
                  </span>
                </div>
                <div
                  style={{
                    position: "relative",
                    height: 10,
                    borderRadius: 6,
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
                      background: cohColor(vc.coh),
                      width: `${vc.coh}%`,
                    }}
                  />
                </div>
                {vc.delta !== 0 && (
                  <div style={{ font: `600 9px ${mono}`, color: cohColor(vc.coh), marginTop: 4 }}>
                    {vc.cohDelta > 0 ? "+" : ""}
                    {vc.cohDelta} vs treaty baseline
                  </div>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  borderTop: "1px solid #23232f",
                  paddingTop: 9,
                }}
              >
                <span style={{ font: `600 9px ${mono}`, letterSpacing: ".1em", color: "#6b6b7a" }}>
                  JOINT COMBAT POWER
                </span>
                <span style={{ font: `700 14px ${mono}`, color: "#e8e8ee" }}>
                  {fmtN(cp.effCP)}{" "}
                  <span style={{ fontSize: 8.5, color: "#8a8a9a" }}>
                    ×{cp.cohFactor.toFixed(2)} coh
                  </span>
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div
                  style={{
                    flex: 1,
                    border: "1px solid #2a2a3d",
                    background: "#16161f",
                    borderRadius: 8,
                    padding: "8px 10px",
                  }}
                >
                  <div
                    style={{ font: `600 8px ${mono}`, letterSpacing: ".06em", color: "#6b6b7a" }}
                  >
                    DEFENSE BUDGET
                  </div>
                  <div style={{ font: `700 13px ${mono}`, color: "#e8e8ee", marginTop: 2 }}>
                    ${vc.budget.toFixed(1)}B
                  </div>
                  {vc.delta !== 0 && (
                    <div style={{ font: `600 8px ${mono}`, color: "#8a8a9a", marginTop: 2 }}>
                      upkeep ${vc.upkeep.toFixed(1)}B · {vc.upDelta >= 0 ? "+" : "−"}$
                      {Math.abs(vc.upDelta).toFixed(1)}B
                    </div>
                  )}
                </div>
                <div
                  style={{
                    flex: 1,
                    border: "1px solid #2a2a3d",
                    background: "#16161f",
                    borderRadius: 8,
                    padding: "8px 10px",
                  }}
                >
                  <div
                    style={{ font: `600 8px ${mono}`, letterSpacing: ".06em", color: "#6b6b7a" }}
                  >
                    POLITICAL CAPITAL
                  </div>
                  <div style={{ font: `700 13px ${mono}`, color: "#d9bd6b", marginTop: 2 }}>
                    {vc.pc} <span style={{ fontSize: 8, color: "#6f8a5a" }}>+{PC_REGEN}/turn</span>
                  </div>
                  <div style={{ font: `600 8px ${mono}`, color: "#8a8a9a", marginTop: 2 }}>
                    order cost {pcCostLabel}
                  </div>
                </div>
              </div>
              <button
                onClick={vc.issue}
                style={{
                  width: "100%",
                  padding: "10px 0",
                  borderRadius: 8,
                  cursor: vc.canIssue ? "pointer" : "default",
                  font: `600 11px ${mono}`,
                  color: vc.canIssue ? org.ac : "#54545f",
                  background: vc.canIssue ? org.acBg : "#16161f",
                  border: `1px solid ${vc.canIssue ? org.acBd : "#2a2a3d"}`,
                }}
              >
                ISSUE ORDER · {pcCostLabel}
              </button>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span style={{ font: `600 9px ${mono}`, color: "#6b6b7a" }}>TURN {vc.turn}</span>
                <button
                  onClick={vc.advanceTurn}
                  style={{
                    font: `600 8.5px ${mono}`,
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "1px solid #2a2a3d",
                    background: "#16161f",
                    color: "#9cc0a0",
                    cursor: "pointer",
                  }}
                >
                  ADVANCE TURN ▸
                </button>
              </div>
            </div>
          </div>
          {vc.orderMsg && (
            <div
              style={{
                marginTop: 12,
                padding: "9px 12px",
                borderRadius: 8,
                background: "rgba(134,217,120,.08)",
                border: "1px solid rgba(134,217,120,.3)",
                font: `600 10px ${mono}`,
                color: "#86d978",
              }}
            >
              ✔ {vc.orderMsg}
            </div>
          )}
        </div>

        {/* allied response wire */}
        <div
          style={{
            marginTop: 10,
            border: "1px solid #2a2416",
            background: "#0a0906",
            borderRadius: 11,
            padding: "11px 15px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px dashed #4a3f1e",
              paddingBottom: 7,
              marginBottom: 5,
            }}
          >
            <span style={{ font: `700 10px ${mono}`, letterSpacing: ".14em", color: "#ffc14d" }}>
              ▌ ALLIED RESPONSE · WIRE
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
              LIVE
            </span>
          </div>
          {vc.reactions.map((r, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 8,
                padding: "5px 0",
                borderBottom: "1px dashed #211c0e",
              }}
            >
              <span style={{ width: 3, flexShrink: 0, borderRadius: 2, background: r.color }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ font: `700 9px ${mono}`, letterSpacing: ".06em", color: r.color }}>
                  {r.who}
                </span>{" "}
                <span style={{ font: `500 10.5px ${mono}`, color: "#d9aa55" }}>{r.text}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* aggregates */}
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10, marginBottom: 18 }}
      >
        {agg.map((a) => (
          <div
            key={a.label}
            style={{
              border: "1px solid #2a2a3d",
              background: "#1a1a25",
              borderRadius: 10,
              padding: "12px 13px",
            }}
          >
            <div style={{ font: `500 8.5px ${mono}`, letterSpacing: ".08em", color: "#6b6b7a" }}>
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
            <div style={{ font: `500 8px ${mono}`, color: "#7a7a8c", marginTop: 1 }}>{a.sub}</div>
          </div>
        ))}
      </div>

      {/* composition */}
      <div
        style={{
          border: "1px solid #2a2a3d",
          background: "#11111a",
          borderRadius: 12,
          padding: "16px 18px",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 11 }}>
          <span style={{ font: `600 10px ${mono}`, letterSpacing: ".14em", color: "#6b6b7a" }}>
            JOINT COMMAND · FORCE COMPOSITION
          </span>
          <span style={{ font: `500 10px ${mono}`, color: "#8a8a9a" }}>
            {Math.round(cp.totalCommK)}K committed
          </span>
        </div>
        <div
          style={{
            display: "flex",
            height: 26,
            borderRadius: 7,
            overflow: "hidden",
            border: "1px solid #23232f",
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
                background: shadeOf(org.ac, i, comp.length, "#0c0c13"),
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
                  background: shadeOf(org.ac, i, comp.length, "#0c0c13"),
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
          border: "1px solid #2a2a3d",
          background: "#14141c",
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
            color: "#6b6b7a",
            borderBottom: "1px solid #2a2a3d",
            background: "#16161f",
          }}
        >
          <span onClick={() => onSort("name")} style={{ cursor: "pointer" }}>
            MEMBER {nameArrow}
          </span>
          <span onClick={() => onSort("commit")} style={{ cursor: "pointer" }}>
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
              borderBottom: "1px solid #1e1e2a",
              background: r.short === vc.vm.short ? org.acBg : i % 2 ? "#16161f" : "transparent",
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
              {r.short === vc.vm.short && (
                <span style={{ font: `600 8px ${mono}`, color: org.ac, letterSpacing: ".06em" }}>
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
        <div style={{ padding: "9px 16px", font: `500 9px ${mono}`, color: "#6b6b7a" }}>
          bar = personnel committed to the joint command · % of that nation&apos;s standing army
        </div>
      </div>
    </div>
  );
}

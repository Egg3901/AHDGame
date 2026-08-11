"use client";

import { useState } from "react";
import {
  AGENTS_MAX,
  AGENTS_START,
  CYCLE_GAIN,
  DISINFO_GAIN,
  INTEL,
  RECRUIT_GAIN,
  control,
  liveOps,
  oppInf,
  playerTotal,
  standing,
  type ExposedMap,
  type IntelConfig,
} from "./intel";
import type { Side } from "./proxyWar";

const mono = "'IBM Plex Mono',monospace";
const serif = "Lora,Georgia,serif";

type Cable = { c: string; t: string };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Intelligence (West "The Station" / East "The Residency · KGB") — clandestine ops. */
export function IntelBoard({ side }: { side: Side }) {
  const cfg = INTEL[side];
  const [selected, setSelected] = useState(cfg.defaultSelected);
  const [agents, setAgents] = useState(AGENTS_START);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [exposed, setExposed] = useState<Record<string, ExposedMap>>({});
  const [network, setNetwork] = useState<Record<string, number>>({});
  const [log, setLog] = useState<Cable[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgErr, setMsgErr] = useState(false);

  const stationCap = cap(cfg.stationWord);
  const pushCable = (c: Cable) => setLog((l) => [c, ...l].slice(0, 6));
  const ok = (m: string) => {
    setMsg(m);
    setMsgErr(false);
  };
  const err = (m: string) => {
    setMsg(m);
    setMsgErr(true);
  };

  const exposedOf = (id: string): ExposedMap => exposed[id] ?? {};
  const networkOf = (id: string) => network[id] ?? 0;
  const exposedTotal = Object.values(exposed).reduce((sum, m) => sum + Object.keys(m).length, 0);

  const select = (id: string) => {
    setSelected(id);
    setMsg(null);
  };

  const deploy = (id: string) => {
    if (revealed[id]) return;
    if (agents < 2) return err(`Not enough ${cfg.agentWord}s — a ${cfg.stationWord} costs 2.`);
    const n = cfg.nations[id];
    setRevealed((m) => ({ ...m, [id]: true }));
    setAgents((a) => a - 2);
    pushCable({
      c: "#86d978",
      t: `${cfg.stationWordUpper} ${n.code} live — ${n.ops.length} ${cfg.opAdj} operation(s) identified.`,
    });
    ok(`${stationCap} established in ${n.name}. True alignment declassified.`);
  };
  const expose = (id: string, opId: string) => {
    if (agents < 1) return err(`No ${cfg.agentWord}s available to run the exposure.`);
    const n = cfg.nations[id];
    const o = n.ops.find((x) => x.id === opId)!;
    setExposed((m) => ({ ...m, [id]: { ...(m[id] ?? {}), [opId]: true } }));
    setAgents((a) => a - 1);
    pushCable({
      c: "#ffc14d",
      t: `EXPOSED: ${o.name} in ${n.name} — splashed across the world press. ${cfg.oppName} scrambles.`,
    });
    ok(
      `${o.name} blown — its ${o.inf} points of ${cfg.opAdj} influence collapse, and ${cfg.oppName}'s standing takes the hit.`
    );
  };
  const recruit = (id: string) => {
    if (agents < 1) return err(`No ${cfg.agentWord}s available to recruit.`);
    const n = cfg.nations[id];
    setNetwork((m) => ({ ...m, [id]: networkOf(id) + RECRUIT_GAIN }));
    setAgents((a) => a - 1);
    pushCable({
      c: cfg.recruit.cableColor,
      t: `${cap(cfg.recruit.noun)} recruited in ${n.name} — +${RECRUIT_GAIN} ${cfg.playerAdj} influence, deeper access.`,
    });
    ok(`New ${cfg.recruit.noun} run in ${n.name}. ${cfg.playerAdj} influence rising.`);
  };
  const disinform = (id: string) => {
    if (agents < 2) return err(cfg.disinform.needMsg);
    const n = cfg.nations[id];
    setNetwork((m) => ({ ...m, [id]: networkOf(id) + DISINFO_GAIN }));
    setAgents((a) => a - 2);
    pushCable({ c: "#c084fc", t: `Active measures in ${n.name} — ${cfg.disinform.cable}` });
    ok(`Disinformation seeded in ${n.name} — local opinion turns against ${cfg.oppName}.`);
  };
  const runCycle = () => {
    setAgents((a) => Math.min(AGENTS_MAX, a + CYCLE_GAIN));
    pushCable({
      c: cfg.cycleCableColor,
      t: `Operations cycle — 3 field ${cfg.cyclePersonWord} return to the roster.`,
    });
    setMsg(null);
  };

  const standingVal = standing(exposedTotal);
  const standingColor = standingVal < 50 ? "#86d978" : standingVal < 75 ? "#eab308" : cfg.opp.text;
  const agentColor = agents < 2 ? "#ff5a3c" : agents < 4 ? "#eab308" : "#f3f1ea";

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
        {/* classification strip */}
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
              INTELLIGENCE · CLANDESTINE OPERATIONS
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
          <div style={{ display: "flex", gap: 10 }}>
            <div
              style={{
                border: `1px solid ${cfg.agentPanelBorder}`,
                background: cfg.agentPanelBg,
                borderRadius: 10,
                padding: "11px 15px",
                minWidth: 100,
              }}
            >
              <span
                style={{
                  font: `600 9px ${mono}`,
                  letterSpacing: ".16em",
                  color: cfg.agentLabelColor,
                }}
              >
                {cfg.agentLabel}
              </span>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: serif,
                  fontWeight: 700,
                  fontSize: 24,
                  lineHeight: 1,
                  color: agentColor,
                }}
              >
                {agents}
              </div>
              <div style={{ marginTop: 3, font: `500 9px ${mono}`, color: cfg.agentSubColor }}>
                deployable
              </div>
            </div>
            <div
              style={{
                border: `1px solid ${cfg.standingPanelBorder}`,
                background: cfg.standingPanelBg,
                borderRadius: 10,
                padding: "11px 15px",
                minWidth: 120,
              }}
            >
              <span
                style={{
                  font: `600 9px ${mono}`,
                  letterSpacing: ".16em",
                  color: cfg.standingLabelColor,
                }}
              >
                {cfg.standingLabel}
              </span>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: serif,
                  fontWeight: 700,
                  fontSize: 24,
                  lineHeight: 1,
                  color: standingColor,
                }}
              >
                {standingVal}
              </div>
              <div style={{ marginTop: 3, font: `500 9px ${mono}`, color: "#7a7a8c" }}>
                {exposedTotal} ops exposed
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 16,
            padding: "12px 24px 24px",
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          {/* watch list */}
          <div
            style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 9 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 2px",
              }}
            >
              <span
                style={{
                  font: `600 10px ${mono}`,
                  letterSpacing: ".14em",
                  color: cfg.watchLabelColor,
                }}
              >
                WATCH LIST
              </span>
              <button
                onClick={runCycle}
                style={{
                  font: `600 8px ${mono}`,
                  padding: "4px 9px",
                  borderRadius: 5,
                  border: `1px solid ${cfg.cycleBtnBorder}`,
                  background: cfg.cycleBtnBg,
                  color: cfg.cycleBtnColor,
                  cursor: "pointer",
                }}
              >
                ▸ RUN CYCLE · +3
              </button>
            </div>
            {cfg.order.map((cid) => {
              const nn = cfg.nations[cid];
              const r = !!revealed[cid];
              const live = r ? liveOps(nn, exposedOf(cid)) : 0;
              const sel = cid === selected;
              const pct = control(nn, networkOf(cid), exposedOf(cid));
              let statusLabel: string;
              let statusColor: string;
              let icon: string;
              if (!r) {
                statusLabel = cfg.darkTitle;
                statusColor = cfg.watchLabelColor;
                icon = "🔒";
              } else if (live > 0) {
                statusLabel = `${pct}% ${cfg.player.short[0] + cfg.player.short.slice(1).toLowerCase()} · ${live} ${side === "west" ? "active" : "CIA"} op(s)`;
                statusColor = cfg.opp.text;
                icon = "⚠️";
              } else {
                statusLabel = `${pct}% ${cfg.player.short[0] + cfg.player.short.slice(1).toLowerCase()} · clean`;
                statusColor = "#86d978";
                icon = "✓";
              }
              return (
                <div
                  key={cid}
                  onClick={() => select(cid)}
                  style={{
                    cursor: "pointer",
                    border: `1px solid ${sel ? "rgba(255,255,255,.25)" : cfg.listBorder}`,
                    background: sel ? cfg.listSelBg : cfg.listBg,
                    borderRadius: 11,
                    padding: "11px 13px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ fontSize: 17, filter: r ? "none" : "grayscale(1) opacity(.6)" }}>
                      {nn.flag}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{ font: "600 12.5px system-ui", color: r ? "#f3f1ea" : "#9595a4" }}
                      >
                        {nn.name}
                      </div>
                      <div style={{ font: `500 8.5px ${mono}`, color: statusColor }}>
                        {statusLabel}
                      </div>
                    </div>
                    <span style={{ fontSize: 13 }}>{icon}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* dossier */}
          <Dossier
            cfg={cfg}
            side={side}
            id={selected}
            revealed={!!revealed[selected]}
            exposedMap={exposedOf(selected)}
            net={networkOf(selected)}
            agents={agents}
            onDeploy={() => deploy(selected)}
            onExpose={(op) => expose(selected, op)}
            onRecruit={() => recruit(selected)}
            onDisinform={() => disinform(selected)}
            msg={msg}
            msgErr={msgErr}
            log={log}
          />
        </div>
      </div>
    </div>
  );
}

function Dossier({
  cfg,
  side,
  id,
  revealed,
  exposedMap,
  net,
  agents,
  onDeploy,
  onExpose,
  onRecruit,
  onDisinform,
  msg,
  msgErr,
  log,
}: {
  cfg: IntelConfig;
  side: Side;
  id: string;
  revealed: boolean;
  exposedMap: ExposedMap;
  net: number;
  agents: number;
  onDeploy: () => void;
  onExpose: (op: string) => void;
  onRecruit: () => void;
  onDisinform: () => void;
  msg: string | null;
  msgErr: boolean;
  log: Cable[];
}) {
  const n = cfg.nations[id];
  const p = control(n, net, exposedMap);
  const playerTot = playerTotal(n, net);
  const oppTot = oppInf(n, exposedMap);

  const badge = !revealed
    ? { t: "CLASSIFIED", c: "#8a8a9a", bg: cfg.classifiedBg, bd: cfg.classifiedBorder }
    : p >= 55
      ? {
          t: cfg.player.leanLabel,
          c: cfg.player.cp,
          bg: cfg.player.badgeBg,
          bd: cfg.player.badgeBorder,
        }
      : p > 45
        ? { t: "CONTESTED", c: "#d9bd6b", bg: "rgba(212,175,55,.1)", bd: "rgba(212,175,55,.35)" }
        : { t: cfg.opp.leanLabel, c: cfg.opp.text, bg: cfg.opp.badgeBg, bd: cfg.opp.badgeBorder };

  const leanNote = p >= 55 ? cfg.leanTilt : p > 45 ? cfg.leanContested : cfg.leanOpp;
  const deployOk = agents >= 2;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 360,
        border: `1px solid ${cfg.dossierBorder}`,
        background: cfg.dossierBg,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "16px 20px",
          borderBottom: `1px solid ${cfg.dossierBorder}`,
        }}
      >
        <span style={{ fontSize: 28, filter: revealed ? "none" : "grayscale(1) opacity(.7)" }}>
          {n.flag}
        </span>
        <div style={{ flex: 1 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: serif,
              fontWeight: 700,
              fontSize: 22,
              color: "#f3f1ea",
            }}
          >
            {n.name}
          </h2>
          <div style={{ font: `500 10px ${mono}`, color: cfg.codeColor, marginTop: 2 }}>
            {n.code} · {n.region}
          </div>
        </div>
        <span
          style={{
            font: `600 9px ${mono}`,
            padding: "4px 11px",
            borderRadius: 6,
            background: badge.bg,
            border: `1px solid ${badge.bd}`,
            color: badge.c,
          }}
        >
          {badge.t}
        </span>
      </div>

      <div style={{ padding: "18px 20px 22px" }}>
        {!revealed ? (
          <div
            style={{
              textAlign: "center",
              padding: "30px 20px",
              border: `1px dashed ${cfg.darkDashBorder}`,
              borderRadius: 12,
              background: cfg.darkBg,
            }}
          >
            <div style={{ fontSize: 30, marginBottom: 10, opacity: 0.5 }}>🔒</div>
            <div style={{ font: `700 14px ${mono}`, letterSpacing: ".1em", color: "#8a8a9a" }}>
              {cfg.darkTitle}
            </div>
            <div
              style={{
                font: `500 11px ${mono}`,
                color: cfg.watchLabelColor,
                margin: "8px auto 0",
                maxWidth: 360,
                lineHeight: 1.5,
              }}
            >
              No {side === "west" ? "assets" : "officers"} in country. Alignment reads{" "}
              <span style={{ color: "#54545f" }}>████</span>, {cfg.darkActivityWord} activity{" "}
              <span style={{ color: "#54545f" }}>█ UNKNOWN █</span>. Deploy a {cfg.stationWord} to
              lift the fog.
            </div>
            <button
              onClick={onDeploy}
              style={{
                marginTop: 16,
                padding: "10px 22px",
                borderRadius: 8,
                cursor: deployOk ? "pointer" : "default",
                font: `600 11px ${mono}`,
                color: deployOk ? "#0a0906" : "#54545f",
                background: deployOk ? "#a9863a" : cfg.deployOffBg,
                border: `1px solid ${deployOk ? "#a9863a" : cfg.deployOffBorder}`,
              }}
            >
              {cfg.deployLabel}
            </button>
          </div>
        ) : (
          <div>
            {/* true alignment — player left, opp right */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                font: `600 10px ${mono}`,
                marginBottom: 7,
              }}
            >
              <span style={{ color: cfg.player.text }}>
                ◂ {cfg.player.short} · {playerTot}
              </span>
              <span style={{ color: cfg.watchLabelColor }}>TRUE ALIGNMENT (DECLASSIFIED)</span>
              <span style={{ color: cfg.opp.text }}>
                {oppTot} · {cfg.opp.short} ▸
              </span>
            </div>
            <div
              style={{
                position: "relative",
                height: 20,
                borderRadius: 10,
                overflow: "hidden",
                background: "#0a0a12",
                border: `1px solid ${cfg.alignTrackBorder}`,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  background: cfg.player.grad,
                  width: `${p}%`,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: 0,
                  bottom: 0,
                  background: cfg.opp.grad,
                  width: `${100 - p}%`,
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
                  left: `${p}%`,
                }}
              />
            </div>
            <div style={{ font: `500 9px ${mono}`, color: "#7a7a8c", marginTop: 6 }}>
              {leanNote}
            </div>

            {/* rival operations */}
            <div
              style={{
                font: `600 10px ${mono}`,
                letterSpacing: ".13em",
                color: cfg.opsLabelColor,
                margin: "18px 0 10px",
              }}
            >
              {cfg.opsLabel} · {n.ops.length}
            </div>
            {n.ops.length === 0 && (
              <div
                style={{
                  border: `1px solid ${cfg.noOpsBorder}`,
                  background: cfg.noOpsBg,
                  borderRadius: 10,
                  padding: 14,
                  font: `500 11px ${mono}`,
                  color: "#86d978",
                }}
              >
                {cfg.opsClean}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {n.ops.map((o) => {
                const ex = !!exposedMap[o.id];
                const exposable = !ex && agents >= 1;
                return (
                  <div
                    key={o.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      border: `1px solid ${ex ? "#23232f" : cfg.opp.opBorder}`,
                      background: ex ? "#131320" : cfg.opp.opBg,
                      borderRadius: 10,
                      padding: "11px 13px",
                    }}
                  >
                    <span style={{ fontSize: 16, opacity: ex ? 0.4 : 1 }}>{o.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          font: "600 12px system-ui",
                          color: ex ? "#6b6b7a" : "#f3f1ea",
                          textDecoration: ex ? "line-through" : "none",
                        }}
                      >
                        {o.name}
                      </div>
                      <div style={{ font: `500 9px ${mono}`, color: "#8a8a9a", marginTop: 2 }}>
                        {o.detail}
                      </div>
                    </div>
                    <span
                      style={{
                        font: `700 11px ${mono}`,
                        color: ex ? "#86d978" : cfg.opp.text,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ex ? "NEUTRALIZED" : `+${o.inf} ${cfg.opp.short[0]}`}
                    </span>
                    <button
                      onClick={() => exposable && onExpose(o.id)}
                      style={{
                        font: `600 9px ${mono}`,
                        padding: "6px 11px",
                        borderRadius: 7,
                        cursor: ex || agents < 1 ? "default" : "pointer",
                        color: ex ? "#86d978" : agents >= 1 ? "#0a0906" : "#54545f",
                        background: ex ? "transparent" : agents >= 1 ? "#ffc14d" : cfg.exposeOffBg,
                        border: `1px solid ${ex ? "rgba(134,217,120,.3)" : agents >= 1 ? "#ffc14d" : cfg.exposeOffBorder}`,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ex ? "EXPOSED ✓" : "⚡ EXPOSE · 1"}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* station ops */}
            <div
              style={{
                font: `600 10px ${mono}`,
                letterSpacing: ".13em",
                color: cfg.counterLabelColor,
                margin: "18px 0 10px",
              }}
            >
              {cfg.counterLabel}
            </div>
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
              <CounterBtn
                cfg={cfg}
                need={1}
                okAgents={agents >= 1}
                info={cfg.recruit}
                icon="🤝"
                color={cfg.recruit.cableColor}
                onClick={onRecruit}
              />
              <CounterBtn
                cfg={cfg}
                need={2}
                okAgents={agents >= 2}
                info={cfg.disinform}
                icon="🎭"
                color="#c084fc"
                onClick={onDisinform}
              />
            </div>
          </div>
        )}

        {msg && (
          <div
            style={{
              marginTop: 14,
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

        {/* cables */}
        <div
          style={{
            marginTop: 16,
            border: `1px solid ${cfg.cablesBorder}`,
            background: cfg.cablesBg,
            borderRadius: 11,
            padding: "11px 15px",
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
            {cfg.cablesLabel}
          </div>
          {log.map((w, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 8,
                padding: "5px 0",
                borderBottom: `1px dashed ${cfg.cablesRowDash}`,
              }}
            >
              <span style={{ width: 3, flexShrink: 0, borderRadius: 2, background: w.c }} />
              <div
                style={{
                  flex: 1,
                  font: `500 10.5px ${mono}`,
                  lineHeight: 1.4,
                  color: cfg.cablesText,
                }}
              >
                {w.t}
              </div>
            </div>
          ))}
          {log.length === 0 && (
            <div
              style={{ padding: "8px 0", font: `500 10px ${mono}`, color: cfg.cablesEmptyColor }}
            >
              {cfg.cablesEmpty}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CounterBtn({
  cfg,
  need,
  okAgents,
  info,
  icon,
  color,
  onClick,
}: {
  cfg: IntelConfig;
  need: number;
  okAgents: boolean;
  info: { name: string; detail: string; eff: string };
  icon: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={() => okAgents && onClick()}
      style={{
        flex: 1,
        minWidth: 200,
        textAlign: "left",
        border: `1px solid ${okAgents ? "rgba(255,255,255,.12)" : "#23232f"}`,
        borderRadius: 9,
        background: okAgents ? "rgba(255,255,255,.02)" : "#131320",
        padding: "11px 13px",
        cursor: okAgents ? "pointer" : "default",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ font: "600 12px system-ui", color: okAgents ? "#e8e8ee" : "#6b6b7a" }}>
          {info.name}
        </span>
      </div>
      <div style={{ font: `500 9px ${mono}`, color: "#8a8a9a", marginTop: 5, lineHeight: 1.4 }}>
        {info.detail}
      </div>
      <div style={{ font: `600 8.5px ${mono}`, color: okAgents ? color : "#54545f", marginTop: 6 }}>
        {info.eff} · {need} {cfg.agentWord}
        {need > 1 ? "s" : ""}
      </div>
    </button>
  );
}

"use client";

import { InfoTooltip } from "@/components/InfoTooltip";
import type { TensionBand, TensionPressureBreakdown } from "@/lib/coldwar/tension";
import type { ColdWarDials } from "@/lib/coldwar/dials";
import { defconColor } from "./defcon";
import { fmtN } from "./orgForces";
import { useTranslations } from "next-intl";

const mono = "'IBM Plex Mono',monospace";
const serif = "Lora,Georgia,serif";

const BAND_COLOR: Record<TensionBand, string> = {
  DETENTE: "#86d978",
  CALM: "#d4af37",
  ELEVATED: "#ff9d49",
  CRISIS: "#ff5a3c",
  BRINK: "#dc2626",
};

const EVENTS_SHOWN = 6;

export interface TensionEventView {
  turn: number;
  label: string;
  delta: number;
}

export interface NuclearPowerView {
  countryId: string;
  flag: string;
  name: string;
  warheads: number;
  bestDevice: string | null;
}

export interface TensionPressureView extends TensionPressureBreakdown {
  escalationLevel: number;
  activeCrisisCount: number;
  totalWarheads: number;
  activeWarCount: number;
  nuclearWarCount: number;
}

export function ColdWarHelp({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <InfoTooltip
      width={310}
      trigger={
        <button
          type="button"
          aria-label={`Explain ${label}`}
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            border: "1px solid #45455b",
            background: "#20202c",
            color: "#b9b9c7",
            font: `700 11px ${mono}`,
            cursor: "help",
          }}
        >
          ?
        </button>
      }
    >
      <div style={{ color: "#e8e8ee", fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ color: "#b4b4c2", lineHeight: 1.5 }}>{children}</div>
    </InfoTooltip>
  );
}

function PressureCard({
  label,
  value,
  detail,
  help,
}: {
  label: string;
  value: number;
  detail: string;
  help: React.ReactNode;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: "10px 12px",
        border: "1px solid #2a2a3d",
        borderRadius: 8,
        background: "#171720",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ font: `600 9px ${mono}`, letterSpacing: ".12em", color: "#858596" }}>
          {label}
        </span>
        <ColdWarHelp label={label}>{help}</ColdWarHelp>
      </div>
      <div style={{ marginTop: 3, font: `700 18px ${mono}`, color: "#f0d08a" }}>+{value}</div>
      <div style={{ marginTop: 2, fontSize: 11, color: "#858596" }}>{detail}</div>
    </div>
  );
}

function EffectCard({
  label,
  value,
  detail,
  color = "#e8e8ee",
  help,
}: {
  label: string;
  value: string;
  detail: string;
  color?: string;
  help: React.ReactNode;
}) {
  return (
    <div style={{ padding: "10px 12px", borderLeft: `2px solid ${color}`, background: "#171720" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ font: `600 9px ${mono}`, letterSpacing: ".12em", color: "#858596" }}>
          {label}
        </span>
        <ColdWarHelp label={label}>{help}</ColdWarHelp>
      </div>
      <div style={{ marginTop: 4, font: `700 17px ${mono}`, color }}>{value}</div>
      <div style={{ marginTop: 3, fontSize: 11, lineHeight: 1.35, color: "#858596" }}>{detail}</div>
    </div>
  );
}

export function TensionHeader({
  tension,
  band,
  defcon,
  events,
  powers,
  pressures,
  dials,
}: {
  tension: number;
  band: TensionBand;
  defcon: number;
  events: TensionEventView[];
  powers: NuclearPowerView[];
  pressures: TensionPressureView;
  dials: Pick<ColdWarDials, "source" | "procurementMultiplier" | "detenteGoodwillPenalty">;
}) {
  const t = useTranslations("worldConflicts.tension");
  const color = BAND_COLOR[band];
  const recent = events.slice(0, EVENTS_SHOWN);
  const direction =
    tension > pressures.floor
      ? `Cooling toward ${pressures.floor}`
      : tension < pressures.floor
        ? `Rising toward ${pressures.floor}`
        : `Holding at ${pressures.floor}`;
  const defconSource =
    dials.source === "vietnam"
      ? "Tightest reading from Vietnam and world tension"
      : dials.source === "tension"
        ? "Set by world tension"
        : "Peacetime readiness";

  return (
    <section
      aria-labelledby="world-tension-title"
      style={{
        margin: "0 auto 18px",
        maxWidth: 1340,
        border: "1px solid #303044",
        background: "linear-gradient(135deg,rgba(22,22,32,.98),rgba(13,13,20,.98))",
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 16px 44px rgba(0,0,0,.22)",
      }}
    >
      <header
        style={{
          padding: "12px 18px",
          borderBottom: "1px solid #303044",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div style={{ font: `600 9px ${mono}`, letterSpacing: ".18em", color: "#a9863a" }}>
            STRATEGIC SITUATION
          </div>
          <h1
            id="world-tension-title"
            style={{ margin: "3px 0 0", font: `700 21px ${serif}`, color: "#f3f1ea" }}
          >
            World tension
          </h1>
        </div>
        <ColdWarHelp label={t("howWorldTensionWorksLabel")}>
          {t("howWorldTensionWorksHelp")}
        </ColdWarHelp>
      </header>

      <div style={{ padding: 18 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1.25fr) minmax(300px,.75fr)",
            gap: 18,
          }}
          className="cw-tension-layout"
        >
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ font: `700 42px/1 ${serif}`, color }}>{Math.round(tension)}</span>
              <span style={{ font: `600 12px ${mono}`, letterSpacing: ".16em", color }}>
                {band}
              </span>
              <span style={{ font: `500 11px ${mono}`, color: "#8b8b9b" }}>/ 100</span>
              <span
                style={{
                  marginLeft: "auto",
                  padding: "4px 8px",
                  borderRadius: 5,
                  background: "#1b1b26",
                  font: `600 10px ${mono}`,
                  color: tension === pressures.floor ? "#b9b9c7" : "#f0d08a",
                }}
              >
                {direction}
              </span>
            </div>

            <div style={{ position: "relative", marginTop: 15, paddingTop: 9 }}>
              <div
                role="meter"
                aria-label="World tension"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(tension)}
                data-tension-gauge
                style={{
                  height: 12,
                  borderRadius: 6,
                  border: "1px solid #343449",
                  background:
                    "linear-gradient(90deg,#426d43 0 15%,#7a6928 15% 35%,#925126 35% 60%,#8f3026 60% 80%,#711c1c 80% 100%)",
                }}
              />
              <span
                data-tension-marker
                style={{
                  position: "absolute",
                  left: `${Math.max(0, Math.min(100, tension))}%`,
                  top: 2,
                  width: 3,
                  height: 27,
                  transform: "translateX(-50%)",
                  background: "#fff",
                  boxShadow: "0 0 8px rgba(255,255,255,.7)",
                }}
              />
              <span
                title={`Standing pressure floor: ${pressures.floor}`}
                style={{
                  position: "absolute",
                  left: `${pressures.floor}%`,
                  top: 5,
                  width: 1,
                  height: 20,
                  borderLeft: "1px dashed #f0d08a",
                }}
              />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "15fr 20fr 25fr 20fr 20fr",
                marginTop: 6,
                font: `600 8px ${mono}`,
                color: "#77778a",
              }}
            >
              <span>DETENTE</span>
              <span>CALM</span>
              <span>ELEVATED</span>
              <span>CRISIS</span>
              <span style={{ textAlign: "right" }}>BRINK</span>
            </div>

            <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 8 }}>
              <h2
                style={{
                  margin: 0,
                  font: `600 10px ${mono}`,
                  letterSpacing: ".14em",
                  color: "#c5c5d0",
                }}
              >
                WHAT HOLDS THE FLOOR AT {pressures.floor}
              </h2>
              <ColdWarHelp label="Pressure floor">{t("pressureFloorHelp")}</ColdWarHelp>
            </div>
            <div
              className="cw-pressure-grid"
              style={{
                marginTop: 9,
                display: "grid",
                gridTemplateColumns: "repeat(5,minmax(0,1fr))",
                gap: 8,
              }}
            >
              <PressureCard
                label="BASELINE"
                value={pressures.baseline}
                detail="always present"
                help="The Cold War starts with a permanent background tension of 12."
              />
              <PressureCard
                label="VIETNAM"
                value={pressures.escalation}
                detail={`rung ${pressures.escalationLevel}`}
                help="Each Vietnam escalation rung adds 4 tension to the floor, capped at 30."
              />
              <PressureCard
                label="ACTIVE CRISES"
                value={pressures.activeCrises}
                detail={`${pressures.activeCrisisCount} open`}
                help="Each active crisis adds 3 tension to the floor, capped at 12."
              />
              <PressureCard
                label="ARSENALS"
                value={pressures.arsenal}
                detail={`${fmtN(pressures.totalWarheads)} warheads`}
                help="All national warheads count. The contribution grows with the square root of the stockpile and caps at 18, so early buildup matters most."
              />
              <PressureCard
                label={t("warsLabel")}
                value={pressures.wars}
                detail={t("warsDetail", {
                  active: pressures.activeWarCount,
                  nuclear: pressures.nuclearWarCount,
                })}
                help={t("warsHelp")}
              />
            </div>
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2
                style={{
                  margin: 0,
                  font: `600 10px ${mono}`,
                  letterSpacing: ".14em",
                  color: "#c5c5d0",
                }}
              >
                CURRENT STRATEGIC EFFECTS
              </h2>
              <ColdWarHelp label="Strategic effects">
                These are derived from the tightest live pressure. Vietnam can impose a tighter
                readiness state than the world tension index by itself.
              </ColdWarHelp>
            </div>
            <div style={{ display: "grid", gap: 8, marginTop: 9 }}>
              <EffectCard
                label="GLOBAL READINESS"
                value={`DEFCON ${defcon}`}
                detail={defconSource}
                color={defconColor(defcon)}
                help="DEFCON counts down from 5 to 1. Lower is more dangerous. World tension can force DEFCON 4 at 45, DEFCON 3 at 65, and DEFCON 2 at 85. A crisis ladder is required for DEFCON 1."
              />
              <EffectCard
                label="PROCUREMENT PRESSURE"
                value={`x${dials.procurementMultiplier.toFixed(2)}`}
                detail="strategic defence-demand dial"
                color="#ffb36b"
                help="The strategic procurement dial rises with tension or an escalation ladder. It is a shared Cold War board signal. Enacted defence spending and available appropriations determine actual orders and purchases."
              />
              <EffectCard
                label="DETENTE PENALTY"
                value={`-${dials.detenteGoodwillPenalty}`}
                detail="goodwill points"
                color="#d5a95a"
                help="The strategic detente dial begins penalizing goodwill above tension 35. It is displayed across the Cold War boards; authored crisis outcomes and stand-down actions define the actual state changes."
              />
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) minmax(300px,.8fr)",
            gap: 18,
          }}
          className="cw-tension-layout"
        >
          <div>
            <div
              style={{
                font: `600 10px ${mono}`,
                letterSpacing: ".14em",
                color: "#c5c5d0",
                marginBottom: 9,
              }}
            >
              NUCLEAR POWERS
            </div>
            {powers.length === 0 ? (
              <div
                style={{
                  padding: "12px 14px",
                  border: "1px dashed #36364a",
                  borderRadius: 8,
                  color: "#9595a4",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                No declared nuclear programme has produced a stockpile. Nuclear-capable defence
                ministries must adopt Nuclear Delivery, test a device, and order production. No
                hidden historical arsenal is seeded.
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {powers.map((p) => (
                  <InfoTooltip
                    key={p.countryId}
                    width={280}
                    trigger={
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                          padding: "8px 11px",
                          borderRadius: 7,
                          border: "1px solid #3b3034",
                          background: "rgba(255,120,73,.05)",
                        }}
                      >
                        <span style={{ fontSize: 15 }}>{p.flag}</span>
                        <span style={{ fontSize: 12, color: "#e8e8ee" }}>{p.name}</span>
                        <span style={{ font: `700 11px ${mono}`, color: "#ff9d7a" }}>
                          {fmtN(p.warheads)} warheads
                        </span>
                        <span style={{ font: `500 9px ${mono}`, color: "#9595a4" }}>
                          {p.bestDevice ? p.bestDevice.toUpperCase() : "PRE-TEST"}
                        </span>
                      </div>
                    }
                  >
                    This stockpile contributes to the arsenal pressure shown above. Tests also add
                    an immediate one-off tension spike. Delivery systems determine whether the
                    stockpile provides credible deterrence.
                  </InfoTooltip>
                ))}
              </div>
            )}
          </div>

          <div>
            <div
              style={{
                font: `600 10px ${mono}`,
                letterSpacing: ".14em",
                color: "#c5c5d0",
                marginBottom: 9,
              }}
            >
              RECENT MOVEMENTS
            </div>
            {recent.length === 0 ? (
              <div
                style={{
                  padding: "12px 14px",
                  border: "1px dashed #36364a",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "#77778a",
                }}
              >
                No one-off movement is on the ledger. The index is being held by the pressure floor
                shown above.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {recent.map((event, index) => (
                  <div
                    key={`${event.turn}-${index}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "44px minmax(0,1fr) 38px",
                      gap: 8,
                      alignItems: "baseline",
                      padding: "5px 0",
                      borderBottom: "1px solid #222230",
                    }}
                  >
                    <span style={{ font: `600 9px ${mono}`, color: "#6b6b7a" }}>T{event.turn}</span>
                    <span style={{ fontSize: 12, color: "#c9c9d4" }}>{event.label}</span>
                    <span
                      style={{
                        textAlign: "right",
                        font: `700 11px ${mono}`,
                        color:
                          event.delta > 0 ? "#ff7849" : event.delta < 0 ? "#86d978" : "#6b6b7a",
                      }}
                    >
                      {event.delta > 0 ? `+${event.delta}` : event.delta}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .cw-tension-layout { grid-template-columns: 1fr !important; }
          .cw-pressure-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 520px) {
          .cw-pressure-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}

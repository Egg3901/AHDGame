import type { Dispatch } from "react";
import { posDef } from "@/lib/military/combat";
import { RESERVE_THEATER_ID } from "@/lib/military/theaters";
import type { NatMods } from "@/lib/military/doctrineTree";
import { MIL_COLOR, MIL_FONT } from "../../military/theme";
import type { CombatState, CombatAction } from "../useCombatState";
import { unitCV, unitPower, unitUpkeep, readyColor, fmtM } from "./combatUi";

const mono = MIL_FONT.mono;

export function OrderOfBattle({
  state,
  natMods,
  dispatch,
}: {
  state: CombatState;
  natMods: NatMods;
  dispatch: Dispatch<CombatAction>;
}) {
  // Group units by where they actually sit — reserve first, then any live conflict
  // a unit is deployed to. Conflicts are dynamic, so the fronts are derived from the
  // units themselves rather than a static theater table.
  const frontIds = Array.from(new Set(state.units.map((u) => u.theaterId))).sort((a, b) =>
    a === RESERVE_THEATER_ID ? -1 : b === RESERVE_THEATER_ID ? 1 : a.localeCompare(b)
  );
  const byFront = frontIds
    .map((id) => ({
      id,
      name: id === RESERVE_THEATER_ID ? "Homeland / Reserve" : id,
      contested: id !== RESERVE_THEATER_ID,
      units: state.units.filter((u) => u.theaterId === id),
    }))
    .filter((g) => g.units.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {byFront.map((front) => (
        <div key={front.id}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span
              style={{
                font: `600 10px ${mono}`,
                letterSpacing: ".14em",
                color: MIL_COLOR.textMuted,
              }}
            >
              {front.name.toUpperCase()}
            </span>
            {front.contested && (
              <span
                style={{
                  font: `600 8px ${mono}`,
                  color: MIL_COLOR.amber,
                  border: `1px solid ${MIL_COLOR.amber}55`,
                  borderRadius: 4,
                  padding: "1px 5px",
                }}
              >
                CONTESTED
              </span>
            )}
            <span style={{ flex: 1, height: 1, background: MIL_COLOR.borderSoft }} />
            <span style={{ font: `500 9px ${mono}`, color: MIL_COLOR.textFaint }}>
              {front.units.length} units
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {front.units.map((u) => {
              const uid = String(u._id);
              const selected = state.selectedUnitId === uid;
              return (
                <button
                  key={uid}
                  onClick={() => dispatch({ type: "SELECT_UNIT", id: uid })}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) auto auto auto auto",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    textAlign: "left",
                    border: `1px solid ${selected ? MIL_COLOR.gold : MIL_COLOR.borderSoft}`,
                    background: MIL_COLOR.inset,
                    borderRadius: 8,
                    padding: "9px 12px",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        fontFamily: MIL_FONT.serif,
                        fontSize: 13,
                        fontWeight: 600,
                        color: MIL_COLOR.text,
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {u.name}
                    </span>
                    <span style={{ font: `500 9px ${mono}`, color: MIL_COLOR.textFaint }}>
                      {u.type}
                    </span>
                  </span>
                  <Stat label="PWR" value={String(unitPower(u))} />
                  <Stat
                    label="CV"
                    value={String(unitCV(state, u, natMods))}
                    color={MIL_COLOR.gold}
                  />
                  <Stat label="UPKEEP" value={fmtM(unitUpkeep(state, u, natMods))} />
                  <span style={{ textAlign: "right" }}>
                    <span style={{ font: `600 11px ${mono}`, color: readyColor(u.readiness) }}>
                      {u.readiness}%
                    </span>
                    <span
                      style={{
                        font: `500 8px ${mono}`,
                        color: MIL_COLOR.textFaint,
                        display: "block",
                      }}
                    >
                      {posDef(u.posture).label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span style={{ textAlign: "right" }}>
      <span style={{ font: `600 11px ${mono}`, color: color ?? MIL_COLOR.text }}>{value}</span>
      <span style={{ font: `500 8px ${mono}`, color: MIL_COLOR.textFaint, display: "block" }}>
        {label}
      </span>
    </span>
  );
}

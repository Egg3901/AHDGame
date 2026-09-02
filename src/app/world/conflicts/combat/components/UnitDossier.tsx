import type { Dispatch } from "react";
import {
  POSTURES,
  ROLES,
  TRAITS,
  computeCard,
  getRole,
  recommendRole,
} from "@/lib/military/combat";
import { rank } from "@/lib/military/generals";
import { isAtConflict, RESERVE_THEATER_ID } from "@/lib/military/theaters";
import { strengthPct } from "@/lib/military/strength";
import { learnedOf } from "@/lib/military/generalsTree";
import { deriveSpec, specLabelOf } from "@/lib/military/deriveSpec";
import type { NatMods } from "@/lib/military/doctrineTree";
import { MIL_COLOR, MIL_FONT } from "../../military/theme";
import type { CombatState, CombatAction } from "../useCombatState";
import { genOf, unitCV, unitPower, unitUpkeep, readyColor, fmtM } from "./combatUi";

const mono = MIL_FONT.mono;

const selectStyle: React.CSSProperties = {
  width: "100%",
  border: `1px solid ${MIL_COLOR.border}`,
  background: MIL_COLOR.inset,
  color: MIL_COLOR.text,
  fontSize: 12,
  borderRadius: 8,
  padding: "8px 10px",
  outline: "none",
  cursor: "pointer",
  fontFamily: MIL_FONT.sans,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          font: `500 9px ${mono}`,
          letterSpacing: ".08em",
          color: MIL_COLOR.textFaint,
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

export function UnitDossier({
  state,
  natMods,
  dispatch,
}: {
  state: CombatState;
  natMods: NatMods;
  dispatch: Dispatch<CombatAction>;
}) {
  const u = state.units.find((x) => String(x._id) === state.selectedUnitId);
  if (!u)
    return (
      <div style={{ font: `500 12px ${mono}`, color: MIL_COLOR.textFaint }}>
        Select a unit from the Order of Battle.
      </div>
    );
  // Null when the archetype is unknown — show the raw headcount, not a fake ratio.
  const strength = strengthPct(u);

  const card = computeCard(u);
  const general = genOf(state, u);
  const role = getRole(state.positions, u);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      {/* left: identity + stats */}
      <div
        style={{
          flex: "1 1 340px",
          minWidth: 300,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontFamily: MIL_FONT.serif,
              fontSize: 22,
              fontWeight: 700,
              color: MIL_COLOR.textStrong,
            }}
          >
            {u.name}
          </h2>
          <div style={{ font: `500 10px ${mono}`, color: MIL_COLOR.textFaint, marginTop: 3 }}>
            {u.type} · {u.domain.toUpperCase()}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            { l: "PWR", v: String(unitPower(u)) },
            { l: "CV", v: String(unitCV(state, u, natMods)), c: MIL_COLOR.gold },
            { l: "UPKEEP", v: fmtM(unitUpkeep(state, u, natMods)) },
            { l: "READY", v: `${u.readiness}%`, c: readyColor(u.readiness) },
          ].map((s) => (
            <div
              key={s.l}
              style={{
                border: `1px solid ${MIL_COLOR.border}`,
                background: MIL_COLOR.inset,
                borderRadius: 9,
                padding: "8px 13px",
                minWidth: 78,
              }}
            >
              <div
                style={{
                  font: `500 8px ${mono}`,
                  letterSpacing: ".1em",
                  color: MIL_COLOR.textFaint,
                }}
              >
                {s.l}
              </div>
              <div
                style={{
                  fontFamily: MIL_FONT.serif,
                  fontSize: 18,
                  fontWeight: 700,
                  marginTop: 2,
                  color: s.c ?? MIL_COLOR.text,
                }}
              >
                {s.v}
              </div>
            </div>
          ))}
        </div>

        {/* stat bars */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {card.stats.map(([label, val]) => (
            <div key={label}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span
                  style={{ fontFamily: MIL_FONT.sans, fontSize: 11.5, color: MIL_COLOR.textMuted }}
                >
                  {label}
                </span>
                <span style={{ font: `600 11px ${mono}`, color: MIL_COLOR.text }}>{val}</span>
              </div>
              <div
                style={{
                  height: 5,
                  borderRadius: 3,
                  background: MIL_COLOR.borderSoft,
                  overflow: "hidden",
                }}
              >
                <div style={{ height: "100%", width: `${val}%`, background: MIL_COLOR.blue }} />
              </div>
            </div>
          ))}
        </div>

        {/* traits */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {card.traitKeys.map((t) => {
            const def = TRAITS[t];
            return (
              <span
                key={t}
                style={{
                  font: `600 9px ${mono}`,
                  color: def?.c ?? MIL_COLOR.textMuted,
                  border: `1px solid ${(def?.c ?? "#888") + "55"}`,
                  background: (def?.c ?? "#888") + "1a",
                  borderRadius: 5,
                  padding: "2px 7px",
                }}
              >
                {def?.label ?? t}
              </span>
            );
          })}
        </div>
      </div>

      {/* right: orders */}
      <div
        style={{
          flex: "1 1 280px",
          minWidth: 260,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          border: `1px solid ${MIL_COLOR.border}`,
          borderRadius: 12,
          background: MIL_COLOR.inset,
          padding: 15,
        }}
      >
        <div
          style={{ font: `600 9px ${mono}`, letterSpacing: ".14em", color: MIL_COLOR.textFaint }}
        >
          UNIT ORDERS
        </div>

        <Field label="POSTURE">
          <select
            aria-label="Posture"
            value={u.posture}
            disabled={!state.canWrite}
            title={state.canWrite ? undefined : "Only the defence minister may change posture."}
            onChange={(e) =>
              dispatch({ type: "SET_POSTURE", id: String(u._id), posture: e.target.value })
            }
            style={{
              ...selectStyle,
              cursor: state.canWrite ? "pointer" : "not-allowed",
              opacity: state.canWrite ? 1 : 0.65,
            }}
          >
            {POSTURES.map((p) => (
              <option
                key={p.id}
                value={p.id}
                disabled={p.id === "garrison" && isAtConflict(u.theaterId)}
              >
                {p.label}
                {p.id === "garrison" && isAtConflict(u.theaterId) ? " — at front" : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label={`BATTLE ROLE${state.positions[String(u._id)] ? "" : " · recommended"}`}>
          <select
            aria-label="Battle role"
            value={role}
            disabled={!state.canWrite}
            title={state.canWrite ? undefined : "Only the defence minister may change battle role."}
            onChange={(e) =>
              dispatch({ type: "SET_ROLE", id: String(u._id), role: e.target.value })
            }
            style={{
              ...selectStyle,
              cursor: state.canWrite ? "pointer" : "not-allowed",
              opacity: state.canWrite ? 1 : 0.65,
            }}
          >
            {ROLES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
                {r.id === recommendRole(u) ? " ★" : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="THEATER">
          {/* Read-only: a unit follows its assigned general to their posting. The
              Secretary of Defense sets a unit's general in the cabinet office. */}
          <div style={{ font: `600 12px ${mono}`, color: MIL_COLOR.text, padding: "7px 0" }}>
            {u.theaterId === RESERVE_THEATER_ID ? "Reserve" : u.theaterId}
          </div>
        </Field>

        <Field label="STRENGTH">
          {/* Personnel scales combat power linearly — a hollow formation fights hollow. */}
          <div
            style={{
              font: `600 12px ${mono}`,
              color: strength === null || strength >= 70 ? MIL_COLOR.text : MIL_COLOR.amber,
              padding: "7px 0",
            }}
          >
            {u.personnel.toLocaleString("en-US")}
            {strength !== null && ` · ${strength}%`}
          </div>
        </Field>

        <div>
          <div
            style={{
              font: `500 9px ${mono}`,
              letterSpacing: ".08em",
              color: MIL_COLOR.textFaint,
              marginBottom: 5,
            }}
          >
            COMMANDING GENERAL
          </div>
          {general ? (
            <div
              style={{
                border: `1px solid ${MIL_COLOR.borderSoft}`,
                borderRadius: 8,
                padding: "8px 10px",
              }}
            >
              <div
                style={{
                  fontFamily: MIL_FONT.serif,
                  fontSize: 13,
                  fontWeight: 600,
                  color: MIL_COLOR.text,
                }}
              >
                {general.name}
              </div>
              <div style={{ font: `500 9px ${mono}`, color: MIL_COLOR.textFaint }}>
                {rank(general.level)} · {specLabelOf(deriveSpec(learnedOf(general)))}
              </div>
            </div>
          ) : (
            <div style={{ font: `500 10px ${mono}`, color: MIL_COLOR.textFaint }}>
              General Staff · unassigned (assigned by the Commanding General)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, type Dispatch } from "react";
import { RESERVE_THEATER_ID } from "@/lib/military/theaters";
import { type CountryId } from "@/lib/constants/countries";
import type { NatMods } from "@/lib/military/doctrineTree";
import { MIL_COLOR, MIL_FONT } from "../../military/theme";
import type { CombatState, CombatAction } from "../useCombatState";
import { unitCV } from "./combatUi";
import { BLOCKADE, wornPenalty } from "@/lib/navair/blockade";
import { integrityMult } from "@/lib/navair/engineCore";
import { FrontMap } from "./FrontMap";
import { BattleOddsBar } from "./BattleOddsBar";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";

const mono = MIL_FONT.mono;

/**
 * The server's projection of this engagement. Computed by the forecast route with the
 * SAME math the turn resolver uses, against the target's real forces — the client does
 * no battle math, and never receives the enemy's roster (see forecastFog).
 */
interface ForecastView {
  oddsPct: number;
  /** The same front from the other end — the enemy's odds if THEY attacked. Not
   *  100 − oddsPct: the defender holds terrain whichever way the attack runs. */
  counterOddsPct: number;
  ownStrength: number;
  supply: { level: number; state: { l: string; c: string } };
  enemyBand: string;
  unopposed: boolean;
  /** Nations pooled on each side by the projection; 1 means fighting alone. */
  alliedContingents?: number;
  enemyContingents?: number;
  navalAirSupport?: {
    closeAirSupportActive: boolean;
    casWeight: number;
    airSuperiority: number;
    interdictionPct: number;
  };
}

export function TheaterWarRoom({
  state,
  natMods,
  dispatch,
}: {
  state: CombatState;
  natMods: NatMods;
  dispatch: Dispatch<CombatAction>;
}) {
  const countryName = useCountryDisplayName();
  // The fronts in play are the live conflicts this country has forces deployed to —
  // derived from the units themselves (their reconciled theaterId), since conflicts
  // are dynamic. Reserve is homeland garrison, not a front.
  const engagedIds = Array.from(
    new Set(state.units.map((u) => u.theaterId).filter((id) => id !== RESERVE_THEATER_ID))
  );
  const [frontId, setFrontId] = useState<string>(engagedIds[0] ?? "");
  const deployed = frontId ? state.units.filter((u) => u.theaterId === frontId) : [];

  // Blockade pressure already falls with hull condition, and below the knee it falls
  // faster than proportionally. Nothing has ever told a commander that, so a blockade
  // that will not bite reads as a broken mechanic rather than as a worn fleet.
  const wornHulls = deployed.filter(
    (u) => u.domain === "naval" && (u.integrity ?? 100) < BLOCKADE.wornKnee
  );
  // Both terms, because both are real. `integrityMult` scales lane pressure linearly and
  // `wornPenalty` adds the knee on top, so quoting the knee alone would badly understate
  // the loss: a hull at 15% applies about 1% of its nominal pressure, not 9%.
  const wornPressureLostPct = wornHulls.length
    ? Math.round(
        (1 -
          wornHulls.reduce((t, u) => t + integrityMult(u.integrity) * wornPenalty(u.integrity), 0) /
            wornHulls.length) *
          100
      )
    : 0;

  const pending = state.pendingDeclarations.find((d) => d.theaterId === frontId);
  const frontReports = state.reports.filter((r) => r.theaterId === frontId);
  const conflict = state.conflicts.find((c) => c.id === frontId) ?? null;

  // Who this nation may declare on HERE — the opposing side's roster at the selected
  // front, resolved server-side. This used to be a global 9-country table filtered by
  // bloc, which offered an East German player its own Warsaw Pact allies (and a "USSR"
  // entry that is not a country) while hiding the NATO belligerents it was actually
  // fighting. Targets belong to a front, not to the world.
  const targets = conflict?.enemyCountries ?? [];
  const [target, setTarget] = useState<string>(targets[0] ?? "");
  // Switching fronts can strand a target that is not a belligerent at the new one; the
  // routes would refuse it, so fall back to the first legal target instead.
  const activeTarget = targets.includes(target) ? target : (targets[0] ?? "");

  // Projection comes from the server: it needs the target's real forces, which the
  // client must never see. Re-fetched whenever the front or the target changes.
  //
  // The settled result is keyed by the request it answers, so status is *derived*
  // rather than set synchronously in the effect (which cascades renders), and a slow
  // response for a previous target can never overwrite the current one.
  const { countryCode, positionId } = state;
  const reqKey = frontId && activeTarget ? `${frontId}|${activeTarget}` : "";
  const [result, setResult] = useState<{
    key: string;
    view: ForecastView | null;
    error: boolean;
  }>({ key: "", view: null, error: false });

  useEffect(() => {
    if (!reqKey) return;
    let cancelled = false;
    const base = `/api/country/${countryCode}/executive/cabinet/${positionId}`;
    const qs = `theaterId=${encodeURIComponent(frontId)}&targetCountry=${encodeURIComponent(activeTarget)}`;
    fetch(`${base}/battle/forecast?${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("forecast unavailable"))))
      .then((j: ForecastView) => {
        if (!cancelled) setResult({ key: reqKey, view: j, error: false });
      })
      .catch(() => {
        if (!cancelled) setResult({ key: reqKey, view: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [reqKey, frontId, activeTarget, countryCode, positionId]);

  const proj = result.key === reqKey ? result.view : null;
  const projStatus: "idle" | "loading" | "error" = !reqKey
    ? "idle"
    : result.key !== reqKey
      ? "loading"
      : result.error
        ? "error"
        : "idle";

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      {/* fronts */}
      <div
        style={{
          flex: "1 1 300px",
          minWidth: 260,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{ font: `600 9px ${mono}`, letterSpacing: ".14em", color: MIL_COLOR.textFaint }}
        >
          ACTIVE FRONTS
        </div>
        {engagedIds.length === 0 && (
          <div style={{ font: `500 11px ${mono}`, color: MIL_COLOR.textFaint, lineHeight: 1.5 }}>
            No active fronts. Deploy forces to a conflict — post a general to it from the cabinet
            office and assign units to them.
          </div>
        )}
        {engagedIds.map((id) => {
          const du = state.units.filter((u) => u.theaterId === id);
          const p = state.pendingDeclarations.find((d) => d.theaterId === id);
          const sel = id === frontId;
          return (
            <button
              key={id}
              onClick={() => setFrontId(id)}
              style={{
                textAlign: "left",
                width: "100%",
                border: `1px solid ${sel ? MIL_COLOR.gold : MIL_COLOR.borderSoft}`,
                background: MIL_COLOR.inset,
                borderRadius: 9,
                padding: "10px 12px",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span
                  style={{
                    fontFamily: MIL_FONT.serif,
                    fontSize: 13,
                    fontWeight: 600,
                    color: MIL_COLOR.text,
                  }}
                >
                  {id}
                </span>
                {p && (
                  <span style={{ font: `600 9px ${mono}`, color: MIL_COLOR.amber }}>OFFENSIVE</span>
                )}
              </div>
              <div style={{ font: `500 9px ${mono}`, color: MIL_COLOR.textFaint, marginTop: 3 }}>
                {du.length} units deployed
              </div>
            </button>
          );
        })}
      </div>

      {/* war room */}
      <div
        style={{
          flex: "2 1 380px",
          minWidth: 320,
          border: `1px solid ${MIL_COLOR.border}`,
          borderRadius: 12,
          background: MIL_COLOR.inset,
          padding: 16,
        }}
      >
        <div
          style={{
            font: `600 9px ${mono}`,
            letterSpacing: ".14em",
            color: MIL_COLOR.textFaint,
            marginBottom: 10,
          }}
        >
          WAR ROOM
          {conflict
            ? ` · ${conflict.name.toUpperCase()}`
            : frontId
              ? ` · ${frontId.toUpperCase()}`
              : ""}
        </div>

        {deployed.length === 0 ? (
          <div style={{ font: `500 12px ${mono}`, color: MIL_COLOR.textFaint }}>
            {frontId
              ? "No units at this front. Post a general here and assign units to them from the cabinet office, then declare an offensive."
              : "Select an active front to plan an offensive. None yet — deploy forces to a conflict first."}
          </div>
        ) : (
          <>
            {/* who holds how much of the host, and the front sweeping across it */}
            {conflict && <FrontMap conflict={conflict} />}

            {/* both directions of the engagement — see BattleOddsBar on why the two
                rows do not sum to 100 */}
            {proj && (
              <BattleOddsBar
                oddsPct={proj.oddsPct}
                enemyOddsPct={proj.counterOddsPct}
                target={activeTarget}
                unopposed={proj.unopposed}
                ownSpectrum={conflict?.ownSpectrum}
              />
            )}

            {/* projected strength, odds and enemy read — all from the server forecast */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
              {[
                {
                  l: "PROJECTED STRENGTH",
                  v: proj ? Math.round(proj.ownStrength).toLocaleString("en-US") : "—",
                  c: MIL_COLOR.blue,
                },
                {
                  l: "SUPPLY",
                  // The band plus the level behind it: STRAINED covers 55 to 84, and a
                  // commander deciding whether to thin a front needs to know which end.
                  v: proj ? `${proj.supply.state.l} (${proj.supply.level}%)` : "—",
                  c: proj ? proj.supply.state.c : MIL_COLOR.textFaint,
                },
                { l: "ENEMY", v: proj ? proj.enemyBand : "—", c: MIL_COLOR.text },
                {
                  l: "CLOSE AIR SUPPORT",
                  v: proj
                    ? proj.navalAirSupport?.closeAirSupportActive
                      ? `ACTIVE (+${proj.navalAirSupport.casWeight})`
                      : "NO ELIGIBLE CAS"
                    : "PENDING",
                  c: proj?.navalAirSupport?.closeAirSupportActive
                    ? MIL_COLOR.blue
                    : MIL_COLOR.textFaint,
                },
                { l: "FORCES", v: String(deployed.length), c: MIL_COLOR.text },
              ].map((s) => (
                <div
                  key={s.l}
                  style={{
                    border: `1px solid ${MIL_COLOR.border}`,
                    background: MIL_COLOR.panel,
                    borderRadius: 9,
                    padding: "8px 13px",
                    minWidth: 92,
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
                      fontSize: 17,
                      fontWeight: 700,
                      marginTop: 2,
                      color: s.c,
                    }}
                  >
                    {s.v}
                  </div>
                </div>
              ))}
            </div>

            {/* Only when there IS something to select. With no opposing nation at this
                front the picker below says so, and asking for a selection as well would
                be instructing an impossible action. */}
            {!activeTarget && targets.length > 0 && (
              <div
                style={{ font: `500 11px ${mono}`, color: MIL_COLOR.textFaint, marginBottom: 12 }}
              >
                Select a target nation to project the engagement.
              </div>
            )}
            {projStatus === "loading" && (
              <div
                style={{ font: `500 11px ${mono}`, color: MIL_COLOR.textFaint, marginBottom: 12 }}
              >
                Projecting…
              </div>
            )}
            {projStatus === "error" && (
              <div
                style={{ font: `500 11px ${mono}`, color: MIL_COLOR.textFaint, marginBottom: 12 }}
              >
                Projection unavailable.
              </div>
            )}
            {wornHulls.length > 0 && (
              <div style={{ font: `500 11px ${mono}`, color: MIL_COLOR.amber, marginBottom: 12 }}>
                {wornHulls.length} of your ships at this front are too badly damaged to blockade
                effectively, costing about {wornPressureLostPct}% of the pressure they would
                otherwise apply. Send them to a home port to repair, or award a defence contract to
                a shipyard so the arsenal can repair them where they are.
              </div>
            )}
            {proj?.unopposed && (
              <div style={{ font: `500 11px ${mono}`, color: MIL_COLOR.amber, marginBottom: 12 }}>
                No enemy forces at this front — an offensive here would meet no resistance.
              </div>
            )}

            <div style={{ font: `500 9px ${mono}`, color: MIL_COLOR.textFaint, marginBottom: 6 }}>
              YOUR FORCES · {deployed.length}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 16 }}>
              {deployed.map((u) => (
                <span
                  key={String(u._id)}
                  style={{
                    font: `500 9px ${mono}`,
                    color: MIL_COLOR.textMuted,
                    border: `1px solid ${MIL_COLOR.borderSoft}`,
                    background: MIL_COLOR.panel,
                    borderRadius: 5,
                    padding: "2px 7px",
                  }}
                >
                  {u.type} · CV {unitCV(state, u, natMods)}
                </span>
              ))}
            </div>

            {/* declare / pending */}
            {pending ? (
              <div
                style={{
                  border: `1px solid ${MIL_COLOR.amber}`,
                  borderRadius: 9,
                  background: MIL_COLOR.panel,
                  padding: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ font: `500 11px ${mono}`, color: MIL_COLOR.text }}>
                  Offensive declared vs <b>{pending.targetCountry}</b> — resolves next turn (T
                  {pending.declaredTurn + 1}).
                </div>
                <button
                  disabled={!state.canWrite}
                  onClick={() => dispatch({ type: "WITHDRAW_DECLARATION", theaterId: frontId })}
                  style={{
                    fontFamily: MIL_FONT.sans,
                    fontWeight: 700,
                    fontSize: 12,
                    color: MIL_COLOR.text,
                    background: "none",
                    border: `1px solid ${MIL_COLOR.border}`,
                    borderRadius: 8,
                    padding: "7px 13px",
                    cursor: state.canWrite ? "pointer" : "not-allowed",
                    opacity: state.canWrite ? 1 : 0.5,
                  }}
                >
                  WITHDRAW
                </button>
              </div>
            ) : targets.length === 0 ? (
              // A front with nobody to declare on — a generated enemy side, or a viewer
              // who is not a belligerent here. Say so, rather than rendering an empty
              // picker under "Select a target nation", which asks for the impossible.
              <div style={{ font: `500 11px ${mono}`, color: MIL_COLOR.textFaint }}>
                No opposing nation to declare against at this front.
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  aria-label="Target nation"
                  value={activeTarget}
                  onChange={(e) => setTarget(e.target.value)}
                  style={{
                    flex: "1 1 140px",
                    fontFamily: MIL_FONT.sans,
                    fontSize: 13,
                    color: MIL_COLOR.text,
                    background: MIL_COLOR.panel,
                    border: `1px solid ${MIL_COLOR.border}`,
                    borderRadius: 8,
                    padding: "10px 12px",
                  }}
                >
                  {targets.map((c) => (
                    <option key={c} value={c}>
                      {/* Named from the country roster, not the situation board's flavour
                          table — that covered 9 nations and would blow up on the rest. */}
                      {countryName(c as CountryId)}
                    </option>
                  ))}
                </select>
                <button
                  disabled={!activeTarget || !state.canWrite}
                  onClick={() =>
                    dispatch({ type: "DECLARE", theaterId: frontId, targetCountry: activeTarget })
                  }
                  style={{
                    flex: "2 1 200px",
                    fontFamily: MIL_FONT.sans,
                    fontWeight: 700,
                    fontSize: 13,
                    color: "#fff",
                    background: MIL_COLOR.red,
                    border: "none",
                    borderRadius: 9,
                    padding: 12,
                    cursor: activeTarget && state.canWrite ? "pointer" : "not-allowed",
                    opacity: activeTarget && state.canWrite ? 1 : 0.5,
                  }}
                >
                  ⚔ DECLARE OFFENSIVE
                </button>
              </div>
            )}

            {/* Both halves of the coalition rule, stated where the order is given.
                Neither is discoverable from the board: one changes who attacks with
                you, the other changes who bleeds when you are attacked. */}
            {frontId && (
              <div
                style={{
                  marginTop: 8,
                  font: `500 11px ${mono}`,
                  color: MIL_COLOR.textMuted,
                  lineHeight: 1.5,
                }}
              >
                Allies who declare against this front before the next turn attack alongside you, as
                one engagement. Your allies posted here defend automatically if this front is
                attacked — posting units to a front commits them to its battles.
              </div>
            )}
          </>
        )}

        {/* Say when the odds already count allied contingents, so a player does not
            read a coalition projection as their own army's strength. */}
        {proj && (proj.alliedContingents ?? 1) > 1 && (
          <div style={{ marginTop: 6, font: `500 11px ${mono}`, color: MIL_COLOR.textMuted }}>
            Odds include {proj.alliedContingents} allied contingents committed to this front.
          </div>
        )}

        {/* A refused order rolls the board back; say why rather than just reverting. */}
        {state.refusal && (
          <div
            role="alert"
            style={{
              marginTop: 10,
              font: `500 11px ${mono}`,
              color: MIL_COLOR.red,
            }}
          >
            {state.refusal}
          </div>
        )}

        {/* engagement reports for this front */}
        {frontReports.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div
              style={{
                font: `600 9px ${mono}`,
                letterSpacing: ".14em",
                color: MIL_COLOR.textFaint,
                marginBottom: 6,
              }}
            >
              ENGAGEMENT REPORTS
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {frontReports.map((r) => (
                <div
                  key={r.id}
                  style={{
                    border: `1px solid ${MIL_COLOR.borderSoft}`,
                    borderRadius: 8,
                    background: MIL_COLOR.panel,
                    padding: "8px 11px",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ font: `500 10px ${mono}`, color: MIL_COLOR.textFaint }}>
                    T{r.turn} · {r.role} vs {r.enemyCountry}
                  </span>
                  {r.noContact ? (
                    <span style={{ font: `600 10px ${mono}`, color: MIL_COLOR.textFaint }}>
                      NO CONTACT
                    </span>
                  ) : (
                    <span
                      style={{
                        font: `600 10px ${mono}`,
                        color: r.win ? MIL_COLOR.green : MIL_COLOR.red,
                      }}
                    >
                      {r.win ? "WON" : "LOST"} · −{r.ownLoss.toLocaleString("en-US")} pers / enemy −
                      {r.enemyLoss.toLocaleString("en-US")}
                      {/* What the engagement actually achieved. Casualties alone left a
                          player saying "I won but have no idea what it means really" —
                          the ground is the answer, and a win that took none is a real
                          outcome worth stating rather than omitting. */}
                      {r.groundPct !== null &&
                        (r.groundPct > 0
                          ? ` · +${r.groundPct}% ground`
                          : r.groundPct < 0
                            ? ` · ${r.groundPct}% ground`
                            : " · line held")}
                      {/* A break-off explains a loss that cost fewer men than usual. */}
                      {r.retreat === "own" && " · withdrew"}
                      {r.retreat === "enemy" && " · enemy withdrew"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

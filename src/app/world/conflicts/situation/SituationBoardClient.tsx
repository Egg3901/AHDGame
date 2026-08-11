"use client";

import Link from "next/link";
import { ClassificationStrip } from "../_coldwar/ClassificationStrip";
import { MIL_COLOR, MIL_FONT } from "../military/theme";
import {
  COUNTRY_COMMAND_FLAVOR,
  DEFAULT_COMMAND_FLAVOR,
  BLOC_BOARD_NAME,
  supplyMult,
  defconFor,
} from "@/lib/military/theaters";
import type { Bloc } from "@/lib/military/bloc";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import type { CountryId } from "@/lib/constants/countries";
import { useTheaterState } from "./useTheaterState";

const mono = MIL_FONT.mono;
const serif = MIL_FONT.serif;
const FR = "#3b82f6"; // friendly
const FRS = "#7ba3ec";
const FRL = "#9cc0f5";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

interface SituationBoardClientProps {
  country: string;
  /**
   * The viewer's bloc, resolved server-side from live organisation membership. A prop
   * rather than a lookup: this is era-dependent and moves when a nation accedes or
   * withdraws, which a static client-side table could never do.
   */
  bloc: Bloc;
  pool: number;
  cohesion: number;
  committed: Record<string, number>;
  conflicts: SituationConflictView[];
}

/**
 * The live data needed to allocate a country's combat power across active conflicts.
 */
export interface SituationConflictView {
  id: string;
  conflictId: number;
  name: string;
  status: string;
  sideA: string;
  sideB: string;
  control: number;
}

/** World Situation Board for live conflicts and persisted combat-power commitments. */
export function SituationBoardClient({
  country,
  bloc,
  pool,
  cohesion,
  committed: committedSeed,
  conflicts,
}: SituationBoardClientProps) {
  const { state, dispatch, saveError } = useTheaterState({
    country,
    countryCode: country.toLowerCase(),
    positionId: DEFENSE_POSITION_BY_COUNTRY[country as CountryId] ?? "",
    cohesion,
    committed: committedSeed,
    pool,
  });

  const C = COUNTRY_COMMAND_FLAVOR[state.country] ?? DEFAULT_COMMAND_FLAVOR;
  // Alignment comes from the live bloc roll the server resolved, never from the
  // flavour table — that table claimed West Germany was NATO in 1953.
  const blocName = BLOC_BOARD_NAME[bloc];
  const total = state.pool;
  const deployed = conflicts.reduce(
    (sum, conflict) => sum + (state.committed[conflict.id] ?? 0),
    0
  );
  const reservePower = Math.max(0, total - deployed);
  const defcon = defconFor(state.cohesion);
  const mult = supplyMult(state.cohesion);

  return (
    <div
      style={{
        padding: 20,
        fontFamily: MIL_FONT.sans,
        color: MIL_COLOR.text,
        background: "radial-gradient(120% 80% at 50% 0%,#15151d,#0b0b11 60%)",
      }}
    >
      {/* A standing autosave refusal would discard every later board edit silently. */}
      {saveError && (
        <div role="alert" style={{ font: `500 11px ${MIL_FONT.mono}`, color: MIL_COLOR.red }}>
          {saveError}
        </div>
      )}
      <div style={{ maxWidth: 1240, margin: "0 auto" }}>
        {/* header panel */}
        <div
          style={{
            border: `1px solid ${MIL_COLOR.border}`,
            borderRadius: 12,
            background: MIL_COLOR.panel,
            overflow: "hidden",
            marginTop: 4,
          }}
        >
          <ClassificationStrip left={C.strip} right={`WORLD SITUATION BOARD · ${C.command}`} />

          <div
            style={{
              padding: "20px 22px",
              display: "flex",
              gap: 18,
              alignItems: "flex-start",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  font: `600 10px ${mono}`,
                  letterSpacing: ".22em",
                  color: MIL_COLOR.textFaint,
                }}
              >
                WORLD · PROXY WARS
              </div>
              <h1
                style={{
                  margin: "6px 0 0",
                  fontFamily: serif,
                  fontSize: 34,
                  fontWeight: 700,
                  color: C.acc,
                  lineHeight: 1,
                }}
              >
                Conflicts
              </h1>
              <p
                style={{
                  margin: "8px 0 0",
                  maxWidth: 560,
                  fontSize: 13,
                  color: MIL_COLOR.textMuted,
                  lineHeight: 1.5,
                }}
              >
                Back a side with your bloc&apos;s combat power. What{" "}
                <Link href="/world/conflicts/combat" style={{ color: FRS }}>
                  Combat Command ▸
                </Link>{" "}
                commits to each front decides the front line — and how far the superpowers escalate.
              </p>
            </div>
            <div
              style={{
                border: `1px solid ${defcon.color}55`,
                background: `linear-gradient(180deg,${defcon.color}1a,rgba(17,17,26,.3))`,
                borderRadius: 12,
                padding: "12px 20px",
                minWidth: 170,
              }}
            >
              <div
                style={{
                  font: `600 9px ${mono}`,
                  letterSpacing: ".18em",
                  color: defcon.color,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 99, background: defcon.color }} />
                READINESS
              </div>
              <div
                style={{
                  fontFamily: serif,
                  fontSize: 28,
                  fontWeight: 700,
                  color: "#fff",
                  marginTop: 4,
                }}
              >
                DEFCON {defcon.level}
              </div>
              <div style={{ font: `500 10px ${mono}`, color: MIL_COLOR.textMuted, marginTop: 1 }}>
                {defcon.note}
              </div>
            </div>
          </div>

          {/* ledger */}
          <div
            style={{
              borderTop: `1px solid ${MIL_COLOR.border}`,
              padding: "15px 22px",
              display: "flex",
              gap: 26,
              alignItems: "center",
              flexWrap: "wrap",
              background: `linear-gradient(90deg,${FR}14,transparent)`,
            }}
          >
            <div
              style={{
                font: `600 10px ${mono}`,
                letterSpacing: ".14em",
                color: FRS,
                display: "flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, background: FR }} />
              {blocName} · COMBAT POWER
            </div>
            {[
              { v: fmt(total), l: "Total (joint command)", c: "#f3f1ea" },
              { v: fmt(deployed), l: "Deployed to fronts", c: FRL },
              { v: fmt(reservePower), l: "In reserve", c: MIL_COLOR.green, reserve: true },
            ].map((x) => (
              <div key={x.l}>
                <div
                  data-reserve-power={x.reserve ? "true" : undefined}
                  style={{ font: `700 22px ${mono}`, color: x.c, lineHeight: 1 }}
                >
                  {x.v}
                </div>
                <div
                  style={{
                    font: `600 9px ${mono}`,
                    letterSpacing: ".14em",
                    color: MIL_COLOR.textFaint,
                    marginTop: 3,
                    textTransform: "uppercase",
                  }}
                >
                  {x.l}
                </div>
              </div>
            ))}
          </div>

          {/* cohesion */}
          <div
            style={{
              borderTop: `1px solid ${MIL_COLOR.border}`,
              padding: "14px 22px",
              display: "flex",
              gap: 14,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div style={{ font: `500 10px ${mono}`, letterSpacing: ".12em", color: FRS }}>
              {blocName} COHESION{" "}
              <span style={{ color: MIL_COLOR.green, fontSize: 14, marginLeft: 6 }}>
                {state.cohesion}%
              </span>
            </div>
            <div style={{ font: `500 9px ${mono}`, color: MIL_COLOR.textMuted }}>
              supply ×{mult} to every front
            </div>
            <div style={{ flex: 1, minWidth: 220, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ font: `500 9px ${mono}`, color: MIL_COLOR.textFaint }}>WITHHELD</span>
              <input
                aria-label="Set bloc cohesion"
                type="range"
                min={40}
                max={100}
                step={1}
                value={state.cohesion}
                onChange={(e) => dispatch({ type: "SET_COHESION", v: +e.target.value })}
                style={{ flex: 1, accentColor: FR, cursor: "pointer" }}
              />
              <span style={{ font: `500 9px ${mono}`, color: MIL_COLOR.textFaint }}>FULL</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div
            style={{
              font: `600 10px ${mono}`,
              letterSpacing: ".16em",
              color: MIL_COLOR.textFaint,
              marginBottom: 10,
            }}
          >
            ACTIVE FRONTS · {conflicts.length}
          </div>
          {conflicts.length === 0 ? (
            <div
              style={{
                border: `1px dashed ${MIL_COLOR.border}`,
                borderRadius: 12,
                padding: "40px 24px",
                textAlign: "center",
                background: MIL_COLOR.panel,
              }}
            >
              <div
                style={{
                  fontFamily: serif,
                  fontSize: 20,
                  fontWeight: 700,
                  color: "#f3f1ea",
                  marginBottom: 8,
                }}
              >
                No active conflicts
              </div>
              <p
                style={{
                  margin: "0 auto",
                  maxWidth: 460,
                  fontSize: 13,
                  color: MIL_COLOR.textMuted,
                  lineHeight: 1.6,
                }}
              >
                The world holds at an uneasy peace. When a conflict breaks out, its front will
                appear here for you to commit combat power to.
              </p>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
                gap: 12,
              }}
            >
              {conflicts.map((conflict) => {
                const committedPower = state.committed[conflict.id] ?? 0;
                const maxCommitment = Math.max(0, total - (deployed - committedPower));
                const sideBControl = Math.max(0, Math.min(100, Math.round(conflict.control)));
                const sideAControl = 100 - sideBControl;

                return (
                  <section
                    key={conflict.id}
                    style={{
                      border: `1px solid ${MIL_COLOR.border}`,
                      borderRadius: 12,
                      padding: "16px 18px",
                      background: MIL_COLOR.panel,
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
                      <div>
                        <Link
                          href={`/world/conflicts/${conflict.conflictId}`}
                          style={{ color: "#f3f1ea", fontFamily: serif, fontWeight: 700 }}
                        >
                          {conflict.name}
                        </Link>
                        <div
                          style={{
                            marginTop: 4,
                            font: `500 10px ${mono}`,
                            color: MIL_COLOR.textMuted,
                          }}
                        >
                          {conflict.sideA} {sideAControl}% / {conflict.sideB} {sideBControl}%
                        </div>
                      </div>
                      <span
                        style={{
                          font: `600 9px ${mono}`,
                          color: MIL_COLOR.amber,
                          textTransform: "uppercase",
                        }}
                      >
                        {conflict.status.replaceAll("_", " ")}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        marginTop: 16,
                      }}
                    >
                      <label
                        htmlFor={`commit-${conflict.id}`}
                        style={{ font: `600 9px ${mono}`, color: MIL_COLOR.textFaint }}
                      >
                        COMBAT POWER
                      </label>
                      <span style={{ font: `700 11px ${mono}`, color: FRS }}>
                        {fmt(committedPower)} CP committed
                      </span>
                    </div>
                    <input
                      id={`commit-${conflict.id}`}
                      aria-label={`Commit combat power to ${conflict.name}`}
                      type="range"
                      min={0}
                      max={maxCommitment}
                      step={1}
                      value={committedPower}
                      onChange={(event) =>
                        dispatch({
                          type: "SET_COMMITTED",
                          id: conflict.id,
                          v: Number(event.target.value),
                        })
                      }
                      style={{ width: "100%", marginTop: 8, accentColor: FR, cursor: "pointer" }}
                    />
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

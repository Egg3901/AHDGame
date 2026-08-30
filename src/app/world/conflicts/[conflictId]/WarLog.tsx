import { MIL_COLOR, MIL_FONT } from "../military/theme";
import { CONFLICT_ARCHIVE_DELAY_TURNS } from "@/lib/military/conflictLifecycle";
import type { RecordBattleRow } from "./conflictRecordView";

const mono = MIL_FONT.mono;

export interface WarLogView {
  battles: RecordBattleRow[];
  sideACountries: string[];
  /** How the log is scoped: whose rosters, if any, the payload carried. */
  note: string;
  /** The war's opening line — the last row, and the only one that is not a report. */
  opening: { year: number; text: string };
}

/** Which side declared, so the row's marker takes that side's colour. */
function declarerSide(row: RecordBattleRow, sideACountries: string[]): "A" | "B" {
  return sideACountries.includes(row.declarer) ? "A" : "B";
}

/**
 * The war, in the order it happened.
 *
 * Every engagement AND every unopposed advance, because both are how a front
 * moves — a war won entirely by walkover previously produced an empty history
 * beside a front that had plainly changed hands. Per-engagement rosters appear
 * exactly where the server put them: own side at `command`, both at `archive`,
 * neither in public.
 */
export function WarLog({ view }: { view: WarLogView }) {
  return (
    <div
      style={{
        border: `1px solid ${MIL_COLOR.border}`,
        borderRadius: 14,
        background: MIL_COLOR.panel,
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{ font: `600 9px ${mono}`, letterSpacing: ".14em", color: MIL_COLOR.textFaint }}
        >
          WAR LOG
        </div>
        <div style={{ font: `500 10px ${mono}`, color: MIL_COLOR.textFaint }}>{view.note}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {view.battles.map((b, i) => {
          const side = declarerSide(b, view.sideACountries);
          const color = side === "A" ? MIL_COLOR.blue : MIL_COLOR.red;
          const ground = b.groundPct;
          // `groundPct` is stated from side A; the row reads declarer → target, so
          // re-sign it for whoever declared this one.
          const declarerGround = ground == null ? null : side === "A" ? ground : -ground;
          return (
            <div
              key={b.id}
              data-battle={b.id}
              style={{
                borderRadius: 9,
                padding: b.rosters ? "12px 13px" : "11px 13px",
                background: i % 2 === 0 ? MIL_COLOR.inset : "transparent",
              }}
            >
              <div className="cw-front-log-row">
                <span style={{ font: `600 10.5px ${mono}`, color: MIL_COLOR.text }}>T{b.turn}</span>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 9999,
                    background: color,
                    boxShadow: `0 0 0 3px ${side === "A" ? "rgba(59,130,246,.15)" : "rgba(220,38,38,.15)"}`,
                  }}
                />
                <span style={{ font: `500 12px ${MIL_FONT.sans}`, color: MIL_COLOR.text }}>
                  {b.attackers.join(", ")} → {b.defenders.join(", ")}
                </span>
                <span
                  style={{
                    font: `600 10.5px ${mono}`,
                    color: b.unopposed ? MIL_COLOR.green : MIL_COLOR.textStrong,
                  }}
                >
                  {b.verdict}
                </span>
                <span
                  style={{
                    font: `500 10px ${mono}`,
                    color: MIL_COLOR.textMuted,
                    textAlign: "right",
                  }}
                >
                  {/* Every belligerent that bled, named for itself. This used to
                      print the declarer beside the WHOLE attacking side's dead, so a
                      two-nation offensive filed its ally's casualties under the
                      principal's flag. */}
                  {b.unopposed
                    ? "no contact"
                    : [...b.attackerLosses, ...b.defenderLosses]
                        .map((c) => `${c.country} ${c.loss.toLocaleString("en-US")}`)
                        .join(" · ")}
                  {/* Absent on reports filed before the front's position was
                      recorded: unknown, not "nothing moved". */}
                  {declarerGround != null && Math.abs(declarerGround) >= 0.1 && (
                    <>
                      {" · "}
                      <span style={{ color: declarerGround > 0 ? MIL_COLOR.green : MIL_COLOR.red }}>
                        {declarerGround > 0 ? "+" : "−"}
                        {Math.abs(declarerGround)} pts
                      </span>
                    </>
                  )}
                </span>
              </div>

              {b.rosters && (
                <div
                  data-rosters
                  style={{
                    borderTop: `1px solid ${MIL_COLOR.borderSoft}`,
                    marginTop: 10,
                    paddingTop: 10,
                    display: "flex",
                    gap: 22,
                    flexWrap: "wrap",
                  }}
                >
                  {b.rosters.map((r) => (
                    <div key={r.country} style={{ flex: 1, minWidth: 210 }}>
                      <div
                        style={{
                          font: `600 9px ${mono}`,
                          color: view.sideACountries.includes(r.country) ? "#9cc0f5" : "#f0a0a0",
                        }}
                      >
                        {r.country} · strength {r.power.toLocaleString("en-US")}
                      </div>
                      {r.units.map((u) => (
                        <div
                          key={u.id}
                          style={{
                            font: `500 10px ${mono}`,
                            color: MIL_COLOR.textMuted,
                            marginTop: 3,
                          }}
                        >
                          {u.name} — {u.casualties.toLocaleString("en-US")} lost
                        </div>
                      ))}
                    </div>
                  ))}
                  {/* The other side's roster is not merely absent — say why, and
                      say that it is coming, so the gap reads as a rule rather
                      than a bug. */}
                  {b.rostersWithheld && (
                    <div
                      style={{
                        flex: 1,
                        minWidth: 210,
                        borderLeft: `1px dashed ${MIL_COLOR.border}`,
                        paddingLeft: 18,
                      }}
                    >
                      <div style={{ font: `600 9px ${mono}`, color: MIL_COLOR.textFaint }}>
                        Opposing force · strength ? ? ?
                      </div>
                      <div
                        style={{
                          font: `500 10px ${mono}`,
                          color: MIL_COLOR.textFaint,
                          marginTop: 4,
                        }}
                      >
                        Roster withheld
                      </div>
                      <div
                        style={{
                          font: `500 9.5px ${mono}`,
                          color: MIL_COLOR.textFaint,
                          marginTop: 3,
                        }}
                      >
                        Unlocks for everyone {CONFLICT_ARCHIVE_DELAY_TURNS} turns after the war
                        resolves.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* The war's own beginning, so the log never starts in the middle. */}
        <div
          className="cw-front-log-row"
          style={{
            padding: "11px 13px",
            borderRadius: 9,
            background: view.battles.length % 2 === 0 ? MIL_COLOR.inset : "transparent",
          }}
        >
          <span style={{ font: `600 10.5px ${mono}`, color: MIL_COLOR.textFaint }}>
            {view.opening.year}
          </span>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: 9999,
              border: `1px solid ${MIL_COLOR.textFaint}`,
            }}
          />
          <span style={{ font: `500 12px ${MIL_FONT.sans}`, color: MIL_COLOR.textMuted }}>
            {view.opening.text}
          </span>
        </div>
      </div>
    </div>
  );
}

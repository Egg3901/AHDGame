import { MIL_COLOR, MIL_FONT } from "../military/theme";
import { READINESS_DRIFT_STEP, readinessBaselineOf } from "@/lib/military/readinessDrift";
import type { ForceRow } from "./conflictRecordView";

const mono = MIL_FONT.mono;

export interface OrderOfBattleView {
  /** Titled for the viewer's seat — what this force IS to them. */
  title: string;
  forces: ForceRow[];
  /** The one coarse read of the opposing force, or null when there is none. */
  enemyBand: string | null;
  /** The opposing side's belligerents — public, unlike their composition. */
  enemyCountries: string[];
  /** True when the opposing side has nothing at this front. */
  unopposed: boolean;
  /**
   * The viewer nation's unfunded upkeep share. Per-row recovery is projected against the
   * SUPPRESSED baseline, so a force its nation cannot pay for is not promised a climb the
   * turn processor will never deliver. Absent = fully funded.
   */
  arrearsRatio?: number;
}

/**
 * The viewer's own formations at this front, and one line about the enemy's.
 *
 * The asymmetry is the point: your side is itemised down to the unit, theirs is a
 * single band. There is no reconnaissance action, no partial reveal and no way to
 * buy a sharper picture — the band is all `buildRecordExtras` ever sends.
 */
export function OrderOfBattlePanel({ view }: { view: OrderOfBattleView }) {
  return (
    <div
      style={{
        border: `1px solid ${MIL_COLOR.borderSoft}`,
        borderRadius: 12,
        background: MIL_COLOR.panel,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          font: `600 9px ${mono}`,
          letterSpacing: ".14em",
          color: MIL_COLOR.textFaint,
          marginBottom: 11,
        }}
      >
        {view.title}
      </div>

      {view.forces.length === 0 ? (
        <div
          style={{
            border: `1px dashed ${MIL_COLOR.border}`,
            borderRadius: 10,
            padding: "16px 14px",
            textAlign: "center",
            color: MIL_COLOR.textFaint,
            font: `500 11px ${mono}`,
          }}
        >
          No forces committed to this front.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {view.forces.map((f) => {
            const target = readinessBaselineOf(f.posture, view.arrearsRatio ?? 0);
            const turnsToFull =
              f.readiness >= target
                ? null
                : Math.ceil((target - f.readiness) / READINESS_DRIFT_STEP);
            return (
              <div
                key={f.id}
                data-force={f.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  border: `1px solid ${MIL_COLOR.borderSoft}`,
                  borderRadius: 10,
                  background: MIL_COLOR.inset,
                  padding: "10px 13px",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ font: `600 12px ${MIL_FONT.sans}`, color: MIL_COLOR.text }}>
                    {f.name}
                  </div>
                  <div style={{ font: `500 9.5px ${mono}`, color: "#7a7a8c", marginTop: 2 }}>
                    {f.type} · {f.posture}
                  </div>
                </div>
                <div
                  style={{
                    font: `500 10px ${mono}`,
                    color: MIL_COLOR.textMuted,
                    textAlign: "right",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {/* Null strength means the archetype is unknown — show nothing
                      rather than a ratio invented from a missing establishment. */}
                  {f.strengthPct == null ? "strength unrecorded" : `${f.strengthPct}% strength`}
                  <br />
                  <span style={{ color: MIL_COLOR.amber }}>rdy {f.readiness}%</span>
                  {turnsToFull != null && (
                    <>
                      <br />
                      <span style={{ color: MIL_COLOR.green, fontSize: 9 }}>
                        +{READINESS_DRIFT_STEP}%/turn · full in {turnsToFull}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view.enemyBand && (
        <div
          style={{
            marginTop: 12,
            borderTop: `1px solid ${MIL_COLOR.borderSoft}`,
            paddingTop: 12,
          }}
        >
          <div
            style={{
              font: `600 9px ${mono}`,
              letterSpacing: ".14em",
              color: MIL_COLOR.textFaint,
              marginBottom: 9,
            }}
          >
            OPPOSING FORCE
          </div>
          <div
            style={{
              border: `1px dashed ${MIL_COLOR.border}`,
              borderRadius: 10,
              background: `repeating-linear-gradient(135deg,${MIL_COLOR.inset} 0 7px,#12121b 7px 14px)`,
              padding: "12px 13px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ font: `600 12px ${MIL_FONT.sans}`, color: "#9cc0f5" }}>
                  {view.enemyBand}
                </div>
                <div
                  style={{ font: `500 9.5px ${mono}`, color: MIL_COLOR.textFaint, marginTop: 3 }}
                >
                  {view.enemyCountries.length > 0
                    ? view.enemyCountries.join(" · ")
                    : "Unaligned force"}{" "}
                  — establishment unknown
                </div>
              </div>
              <div
                style={{
                  font: `600 16px ${mono}`,
                  color: MIL_COLOR.textFaint,
                  letterSpacing: ".14em",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {view.unopposed ? "—" : "? ? ?"}
              </div>
            </div>
            <div
              style={{
                font: `500 10px ${mono}`,
                color: MIL_COLOR.textFaint,
                lineHeight: 1.6,
                marginTop: 9,
              }}
            >
              {view.unopposed
                ? "Nothing to fog — an empty front tells you it is empty, which is itself information."
                : "One line is the whole readout. There is no reconnaissance action, no partial reveal, and no way to buy a sharper picture — the band is all the server ever sends."}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

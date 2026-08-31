"use client";

import { useEffect, useState } from "react";
import { MIL_COLOR, MIL_FONT } from "../military/theme";

const mono = MIL_FONT.mono;

/** The server's projection of this engagement, both directions. */
interface ForecastView {
  oddsPct: number;
  counterOddsPct: number;
  unopposed: boolean;
  navalAirSupport?: {
    closeAirSupportActive: boolean;
    casWeight: number;
    airSuperiority: number;
    interdictionPct: number;
  };
}

interface DeclarationHistoryItem {
  id: string;
  declarerCountry: string;
  targetCountry: string;
  declaredTurn: number;
  resolvedTurn: number | null;
  status: "resolved" | "fizzled";
  /** What it achieved, from the declarer's side — "Victory", "unopposed advance". */
  outcome: string;
  /**
   * Whether the outcome went the VIEWER's way. Both sides' offensives appear in this
   * list, so a declarer's victory is the viewer's defeat when the viewer is the
   * target. Null when there is no result to take a side on.
   */
  favorable: boolean | null;
}

/**
 * Declare or withdraw an offensive at this conflict, with the odds beside it.
 *
 * Rendered only for a viewer who may act here — the page mirrors `canActAtTheater`
 * (Theater Commander where designated, otherwise the defense holder, admin always)
 * and a resolved war has no actions. The routes are the same two the war room uses;
 * this is simply a second consumer, so authority is still enforced server-side.
 */
export function ConflictActions({
  theaterId,
  countryCode,
  positionId,
  targets,
  pendingTarget,
  declarationHistory = [],
  ownSpectrum = "west",
  autoJoin = false,
}: {
  theaterId: string;
  countryCode: string;
  positionId: string;
  /** Opposing-side nations that can be declared on. */
  targets: string[];
  /** The target of a pending offensive, when one is already filed. */
  pendingTarget: string | null;
  /** Recent completed offensive declarations at this front. */
  declarationHistory?: DeclarationHistoryItem[];
  /** Cold War spectrum of the viewer's side, used for odds coloring. */
  ownSpectrum?: "west" | "east" | "neutral";
  /** Whether this nation already holds a standing order to join allied offensives here. */
  autoJoin?: boolean;
}) {
  const [target, setTarget] = useState<string>(targets[0] ?? "");
  const [pending, setPending] = useState<string | null>(pendingTarget);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [joining, setJoining] = useState(autoJoin);
  const [savingJoin, setSavingJoin] = useState(false);

  const base = `/api/country/${countryCode}/executive/cabinet/${positionId}`;

  /**
   * Standing order, not an action: it changes what the next tick does with an ally's
   * declaration and nothing about this turn. Optimistic, because the only failure worth
   * showing is a refusal, and it reverts on one.
   */
  async function toggleAutoJoin() {
    const next = !joining;
    setJoining(next);
    setSavingJoin(true);
    setRefusal(null);
    try {
      const res = await fetch(`${base}/battle/auto-join`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theaterId, enabled: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setJoining(!next);
        setRefusal(body?.error ?? "Could not save that order.");
      }
    } catch {
      setJoining(!next);
      setRefusal("Could not save that order.");
    } finally {
      setSavingJoin(false);
    }
  }

  // Project the offensive that is actually FILED once one is, not whatever the picker
  // happens to hold. The odds used to be shown only before declaring and hidden the
  // moment you committed — backwards, and the reason a player asked "can we get more
  // info here on what this means and the chance of success?" while looking at a
  // pending offensive.
  const projectionTarget = pending ?? target;

  // The settled projection is keyed to the request it answers, so nothing is set
  // synchronously in the effect and a slow reply for a previous target cannot
  // overwrite the current one.
  const reqKey = projectionTarget ? `${theaterId}|${projectionTarget}` : "";
  const [result, setResult] = useState<{
    key: string;
    view: ForecastView | null;
    error: boolean;
  }>({ key: "", view: null, error: false });

  useEffect(() => {
    if (!reqKey) return;
    let cancelled = false;
    const qs = `theaterId=${encodeURIComponent(theaterId)}&targetCountry=${encodeURIComponent(projectionTarget)}`;
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
  }, [reqKey, base, theaterId, projectionTarget]);

  const proj = result.key === reqKey ? result.view : null;
  const failed = result.key === reqKey && result.error;

  const ownColor =
    ownSpectrum === "east"
      ? MIL_COLOR.red
      : ownSpectrum === "neutral"
        ? MIL_COLOR.gold
        : MIL_COLOR.blue;
  const opposingColor =
    ownSpectrum === "east"
      ? MIL_COLOR.blue
      : ownSpectrum === "neutral"
        ? MIL_COLOR.textMuted
        : MIL_COLOR.red;

  /**
   * One direction of the engagement. The two rows are SEPARATE engagements, not a
   * partition of one quantity: the defender holds terrain whichever way the attack
   * runs, so with comparable forces both sides can project themselves under 50%.
   */
  const oddsRow = (label: string, pct: number | null, color: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 7 }}>
      <span style={{ font: `500 10px ${mono}`, color: MIL_COLOR.textMuted, width: 88 }}>
        {label}
      </span>
      <span
        style={{
          font: `600 12px ${mono}`,
          color: pct == null ? MIL_COLOR.textFaint : color,
          width: 42,
          textAlign: "right",
        }}
      >
        {/* The value crosses an untyped JSON boundary, so a missing field must
            read as unavailable rather than rendering "undefined%". */}
        {pct == null || !Number.isFinite(pct) ? "—" : `${pct}%`}
      </span>
      <div
        style={{
          flex: 1,
          height: 7,
          borderRadius: 4,
          overflow: "hidden",
          background: MIL_COLOR.panelAlt,
          border: `1px solid ${MIL_COLOR.borderSoft}`,
        }}
      >
        {pct != null && Number.isFinite(pct) && (
          <div
            style={{
              width: `${Math.max(0, Math.min(100, pct))}%`,
              height: "100%",
              background: color,
            }}
          />
        )}
      </div>
    </div>
  );

  /** The projection block, shown whether or not an offensive is already filed. */
  const odds = failed ? (
    <div style={{ font: `500 10px ${mono}`, color: MIL_COLOR.textFaint }}>
      Projection unavailable.
    </div>
  ) : proj ? (
    <>
      {oddsRow(`You attack ${projectionTarget}`, proj.oddsPct, ownColor)}
      {/* An enemy with no force at this front has nothing to attack WITH, which
          is a different statement from a low chance of success. */}
      {oddsRow("They attack", proj.unopposed ? null : proj.counterOddsPct, opposingColor)}
      <div
        style={{
          font: `500 10px ${mono}`,
          color: MIL_COLOR.textMuted,
          marginTop: 10,
          lineHeight: 1.6,
        }}
      >
        {proj.unopposed
          ? "Nothing opposes you here, so the advance itself is uncontested — the percentage is the chance of a decisive result, not of taking ground."
          : "Both rows are separate engagements, not halves of one number: the defender holds terrain whichever way the attack runs, so both sides can sit under 50%."}{" "}
        Projection only — it moves if either side reinforces before the tick.
        {proj.navalAirSupport && (
          <>
            {" "}
            Close air support: {proj.navalAirSupport.closeAirSupportActive
              ? `active (+${proj.navalAirSupport.casWeight} combat weight)`
              : "no eligible CAS wing is reaching this front"}.
          </>
        )}
      </div>
    </>
  ) : null;

  // Optimistic, but ROLLED BACK on refusal and the server's reason surfaced. The
  // routes re-check authority (canActAtTheater), opposing SIDE, forces present and
  // duplicate declarations — fire-and-forget would leave the panel claiming an
  // offensive is pending that the server rejected.
  async function declare() {
    const previous = pending;
    setPending(target);
    setRefusal(null);
    try {
      const res = await fetch(`${base}/battle/declare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theaterId, targetCountry: target }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setPending(previous);
        setRefusal(body?.error ?? "The offensive was refused.");
      }
    } catch {
      setPending(previous);
      setRefusal("The offensive could not be filed.");
    }
  }

  async function withdraw() {
    const previous = pending;
    setPending(null);
    setRefusal(null);
    try {
      const res = await fetch(`${base}/battle/declare?theaterId=${encodeURIComponent(theaterId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setPending(previous);
        setRefusal(body?.error ?? "The withdrawal was refused.");
      }
    } catch {
      setPending(previous);
      setRefusal("The withdrawal could not be filed.");
    }
  }

  const btn = (tone: "gold" | "plain") => ({
    border: `1px solid ${tone === "gold" ? MIL_COLOR.gold : MIL_COLOR.border}`,
    background: tone === "gold" ? "rgba(212,175,55,.14)" : MIL_COLOR.panelAlt,
    color: tone === "gold" ? MIL_COLOR.gold : MIL_COLOR.text,
    borderRadius: 8,
    padding: "8px 15px",
    font: `600 10px ${mono}`,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  });

  return (
    <div
      style={{
        padding: "14px 16px",
        border: `1px solid ${MIL_COLOR.border}`,
        borderRadius: 12,
        background: MIL_COLOR.panel,
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
        COMMAND
      </div>

      {refusal && (
        <div style={{ font: `500 10.5px ${mono}`, color: "#ff5a3c", marginBottom: 10 }}>
          {refusal}
        </div>
      )}

      {/* A standing order sits above the one-shot controls: it governs every turn, not
          this one, and reading it after the declare button would imply otherwise. */}
      <label
        data-auto-join
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 9,
          marginBottom: 13,
          paddingBottom: 13,
          borderBottom: `1px solid ${MIL_COLOR.borderSoft}`,
          cursor: savingJoin ? "wait" : "pointer",
          opacity: savingJoin ? 0.6 : 1,
        }}
      >
        <input
          type="checkbox"
          checked={joining}
          disabled={savingJoin}
          onChange={toggleAutoJoin}
          style={{ marginTop: 2, accentColor: MIL_COLOR.blue, cursor: "inherit" }}
        />
        <span>
          <span style={{ font: `600 11px ${mono}`, color: MIL_COLOR.text }}>
            Join allied offensives automatically
          </span>
          <span
            style={{
              display: "block",
              font: `500 10px ${mono}`,
              color: MIL_COLOR.textMuted,
              marginTop: 3,
              lineHeight: 1.5,
            }}
          >
            Your forces at this front will fight in any offensive an ally declares here, without a
            separate order from you.
          </span>
        </span>
      </label>

      {targets.length === 0 ? (
        <div style={{ font: `500 11px ${mono}`, color: MIL_COLOR.textFaint }}>
          No opposing nation to declare against at this front.
        </div>
      ) : pending ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 13,
            }}
          >
            <span style={{ font: `500 11px ${mono}`, color: MIL_COLOR.amber }}>
              Offensive pending against {pending} — resolves on the next turn.
            </span>
            <button onClick={withdraw} style={btn("plain")}>
              Withdraw
            </button>
          </div>
          {/* The odds for the offensive you have actually committed to — the single
              most useful thing to see while deciding whether to hold or withdraw. */}
          {odds}
        </>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              flexWrap: "wrap",
              marginBottom: 13,
            }}
          >
            <label style={{ font: `500 10px ${mono}`, color: "#7a7a8c" }} htmlFor="cw-target">
              Target
            </label>
            <select
              id="cw-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              style={{
                border: `1px solid ${MIL_COLOR.border}`,
                background: MIL_COLOR.inset,
                color: MIL_COLOR.text,
                borderRadius: 8,
                padding: "6px 10px",
                font: `500 11px ${mono}`,
              }}
            >
              {targets.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button onClick={declare} style={btn("gold")}>
              Declare offensive
            </button>
          </div>

          {odds}
        </>
      )}

      {declarationHistory.length > 0 && (
        <div
          style={{
            marginTop: 14,
            borderTop: `1px solid ${MIL_COLOR.borderSoft}`,
            paddingTop: 12,
          }}
        >
          <div
            style={{
              font: `600 9px ${mono}`,
              letterSpacing: ".14em",
              color: MIL_COLOR.textFaint,
              marginBottom: 7,
            }}
          >
            RECENT OFFENSIVES
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {declarationHistory.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  flexWrap: "wrap",
                  font: `500 10px ${mono}`,
                  color: MIL_COLOR.textMuted,
                }}
              >
                <span>
                  T{item.declaredTurn} · {item.declarerCountry} → {item.targetCountry}
                </span>
                {/* The outcome, not just the fact that the turn processor reached it.
                    Coloured from the viewer's side; neutral when there is no result to
                    take a side on, so "no contact" never reads as a win or a loss. */}
                <span
                  style={{
                    color:
                      item.favorable === null
                        ? MIL_COLOR.textMuted
                        : item.favorable
                          ? "#86d978"
                          : "#ff5a3c",
                  }}
                >
                  {item.outcome}
                  {item.status === "resolved" && item.resolvedTurn != null
                    ? ` · T${item.resolvedTurn}`
                    : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

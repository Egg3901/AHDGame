"use client";

import { useEffect, useState } from "react";
import type { DossierView } from "@/lib/settlement/queries/dossier";
import { SplitBar } from "./SplitBar";

/**
 * Countdown to the next tick.
 *
 * The server hands over a timestamp, never a formatted string — a preformatted
 * "41:07" is stale the moment it renders. Returns null until mounted so the
 * server and client markup agree on the first paint.
 */
function useCountdown(nextTurnAt: string | null): string | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    // Deferred rather than called inline: a synchronous setState in an effect
    // body cascades renders. Staying null until the first tick is also what
    // keeps the server and client markup identical on the first paint.
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  if (now === null || !nextTurnAt) return null;
  const remaining = new Date(nextTurnAt).getTime() - now;
  if (!Number.isFinite(remaining)) return null;
  if (remaining <= 0) return "due";
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div className="font-mono text-body-xs font-semibold tracking-widest text-muted">{label}</div>
      <div className={`font-serif text-display font-bold leading-tight ${tone}`}>{value}</div>
    </div>
  );
}

export function Masthead({ view }: { view: DossierView }) {
  const countdown = useCountdown(view.nextTurnAt);
  const seat = view.viewer.seat;
  const driftTone = view.drift.last >= 0 ? "text-error" : "text-info";

  return (
    <div className="overflow-hidden rounded-lg border border-card-border bg-background shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-card-border bg-card-muted px-5 py-2">
        <span className="font-mono text-body-xs font-semibold tracking-widest text-gold">
          ◆ FLASH · FOUR-POWER MATTER — ALL DELEGATIONS
        </span>
        <span className="font-mono text-body-xs tracking-wider text-gold-muted">
          OPEN LOG · TURN {view.turn}
          {countdown ? ` · TICK IN ${countdown}` : ""}
        </span>
      </div>

      <div className="flex flex-wrap">
        <div className="min-w-[320px] flex-1 px-6 py-6">
          <p className="mb-1.5 font-mono text-body-xs font-semibold tracking-widest text-gold-muted">
            STANDING CRISIS · NO EXPIRY · GAME-WIDE
          </p>
          <h1 className="font-serif text-display font-bold leading-none text-foreground">
            The German Question
          </h1>
          <p className="mt-2.5 max-w-[600px] text-pretty text-body leading-relaxed text-muted">
            Bonn will not choose for itself. Four institutions decide whether West Germany stays
            sovereign inside NATO or dissolves into a reunified Germany in the Warsaw Pact — each
            one contested separately, each one weighted. Every coercive play leaves heat on the
            ladder, and the ladder ends in a war neither bloc has planned for.
          </p>

          <div className="mt-5 flex flex-wrap items-start gap-6">
            <Stat label="SOVEREIGN · NATO" value={`${view.westPct}%`} tone="text-info" />
            <div className="w-px self-stretch bg-card-border" />
            <Stat label="REUNIFIED · PACT" value={`${view.eastPct}%`} tone="text-error" />
            <div className="w-px self-stretch bg-card-border" />
            <Stat label="LADDER HEAT" value={`${view.heat}/5`} tone="text-warning" />
            <div className="w-px self-stretch bg-card-border" />
            <div>
              <div className="font-mono text-body-xs font-semibold tracking-widest text-muted">
                STANDING
              </div>
              <div
                className={`mt-2 max-w-[200px] font-mono text-body-sm font-semibold leading-snug ${
                  view.eastPct > view.westPct ? "text-error" : "text-info"
                }`}
              >
                {view.leadNote}
              </div>
            </div>
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-3 border-card-border bg-card-muted px-5 py-5 lg:w-[336px] lg:border-l">
          <div>
            <div className="font-mono text-body-xs font-bold tracking-wider text-muted">
              BONN&apos;S OWN DRIFT · LAST TICK
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
              <span className={`font-serif text-display font-bold leading-none ${driftTone}`}>
                {view.drift.last >= 0 ? "+" : ""}
                {view.drift.last.toFixed(1)}
              </span>
              <span className="font-mono text-body-xs text-muted">
                toward {view.drift.last >= 0 ? "reunification" : "NATO"} ·{" "}
                {view.drift.revealed ? view.drift.band : "band undisclosed"}
              </span>
            </div>
            <div className="mt-1.5 font-mono text-body-xs leading-relaxed text-muted">
              {view.drift.history.length > 0
                ? `last ${view.drift.history.length} ticks ${view.drift.history
                    .map((d) => `${d >= 0 ? "+" : ""}${d.toFixed(1)}`)
                    .join(", ")} — band undisclosed until it lands`
                : "no ticks recorded yet"}
            </div>
          </div>

          <div className="h-px bg-card-border" />

          <div>
            <div className="font-mono text-body-xs font-bold tracking-wider text-muted">
              NEXT TICK
            </div>
            <div className="mt-1.5 font-serif text-heading-lg font-bold leading-none text-foreground">
              {countdown ?? "—"}
            </div>
            <div className="mt-1 font-mono text-body-xs text-muted">
              turn {view.turn} · DEFCON {view.defcon}
            </div>
          </div>

          <div className="h-px bg-card-border" />

          <div>
            <div className="font-mono text-body-xs font-bold tracking-wider text-muted">
              {seat ? `${seat.name} · ON HAND` : "NO DELEGATION · ON HAND"}
            </div>
            <div className="mt-1.5 flex flex-col gap-1 font-mono text-body-sm font-semibold text-foreground">
              {seat ? (
                <>
                  <span>
                    {seat.capital} {seat.capitalLabel}
                  </span>
                  <span>{seat.treasuryLabel} treasury</span>
                  <span className="text-gold">
                    {seat.actionsRemaining} / {seat.actionsBankCap} AP banked (+
                    {seat.actionsPerTurn}/turn) · {seat.multiplier} seat multiplier
                  </span>
                </>
              ) : (
                <span className="text-gold">
                  {view.viewer.personalActions} personal actions · 0.25× open floor
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <SplitBar eastPct={view.eastPct} height="lg" thresholds />

      <div className="flex flex-wrap justify-between gap-2 bg-card-muted px-5 pb-2.5 pt-1.5 font-mono text-body-xs text-muted">
        <span>15% · INDEPENDENCE LOCKED</span>
        <span className="hidden sm:inline">
          NO CLOCK — RESOLVES WHEN A THRESHOLD BREAKS, OR ON WAR
        </span>
        <span>85% · REUNIFICATION CARRIES</span>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useState } from "react";
import type { DossierView } from "@/lib/settlement/queries/dossier";
import { Masthead } from "./Masthead";
import { InstitutionCard } from "./InstitutionCard";
import { DelegationBench, OpenFloorPanel } from "./DelegationBench";
import { EscalationLadder } from "./EscalationLadder";
import { FourPowerWire } from "./FourPowerWire";
import { PlayButton } from "./PlayButton";
import { SeatSwitcher } from "./SeatSwitcher";

/**
 * The dossier — layout `4 · BLEND ✦` from the source design.
 *
 * Holds the view and refetches it after a play lands, so the board a player
 * sees is the board the turn phase will read.
 */
export function GermanQuestionClient({ initialView }: { initialView: DossierView }) {
  const [view, setView] = useState(initialView);
  const [mode, setMode] = useState<"seat" | "personal">(
    initialView.viewer.seat ? "seat" : "personal"
  );
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch("/api/world/german-question");
      if (!res.ok) {
        setRefreshError("The board could not be refreshed. Your play may still have landed.");
        return;
      }
      const body = (await res.json()) as { view: DossierView };
      setView(body.view);
    } catch {
      setRefreshError("The board could not be refreshed. Your play may still have landed.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  // A play a seat cannot make is not offered under the seat hat, and vice
  // versa. The read model returns both catalogues; the switcher picks one.
  const seatName = view.viewer.seat?.name ?? null;

  return (
    <div className="mx-auto flex max-w-[1620px] flex-col gap-4 px-4 pb-16 pt-5 sm:px-6">
      <Masthead view={view} />

      <SeatSwitcher view={view} mode={mode} onModeChange={setMode} />

      {refreshError && (
        <p role="alert" className="font-mono text-body-xs text-error">
          {refreshError}
        </p>
      )}

      {mode === "seat" && view.settlementPlays.length > 0 && (
        <section className="flex flex-wrap items-center gap-4 rounded-xl border border-gold/35 bg-gold/[0.05] px-4 py-3.5">
          <div className="min-w-[200px] shrink-0">
            <h2 className="font-mono text-body-xs font-bold tracking-widest text-gold">
              ◆ SETTLEMENT-LEVEL PLAYS
            </h2>
            <p className="mt-1 max-w-[250px] font-mono text-body-xs leading-relaxed text-gold-muted">
              Bypasses the institutions — moves the weighted index directly.
            </p>
          </div>
          <div className="grid min-w-[280px] flex-1 gap-2.5 sm:grid-cols-2">
            {view.settlementPlays.map((play) => (
              <PlayButton key={play.id} play={play} onCommitted={refresh} />
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex w-full shrink-0 flex-col gap-3 lg:w-[280px]">
          <DelegationBench title="🦅 NATO DELEGATIONS" bloc="west" seats={view.benches.west} />
          <OpenFloorPanel openFloor={view.openFloor} />
        </div>

        <div
          className={`grid min-w-[320px] flex-1 content-start gap-3.5 sm:grid-cols-2 ${
            refreshing ? "opacity-70" : ""
          }`}
          aria-busy={refreshing}
        >
          {view.institutions.map((institution) => (
            <InstitutionCard
              key={institution.id}
              institution={institution}
              mode={mode}
              seatName={seatName}
              onCommitted={refresh}
            />
          ))}
        </div>

        <div className="flex w-full shrink-0 flex-col gap-3 lg:w-[280px]">
          <DelegationBench
            title="☭ WARSAW PACT DELEGATIONS"
            bloc="east"
            seats={view.benches.east}
          />
          <EscalationLadder view={view} onArmed={refresh} />
        </div>
      </div>

      <FourPowerWire lines={view.wire} />
    </div>
  );
}

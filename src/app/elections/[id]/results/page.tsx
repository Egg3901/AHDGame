"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import BackButton from "@/components/BackButton";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";
import {
  buildSimulationScript,
  simulationFrame,
  type SimulationScript,
} from "@/lib/elections/liveResults/simulateResults";
import { useElectionNightLoad, useElectionNightPoll } from "@/hooks/useElectionNight";
import { ElectionResultsSkeleton } from "./components/ElectionResultsSkeleton";
import { LiveResultsShell } from "./components/LiveResultsShell";

/** Compressed election night: full replay in ~75s, one frame every 1.5s. */
const SIM_TICK_MS = 1500;
const SIM_STEP = 0.03;

export default function LiveElectionResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { state, reload } = useElectionNightLoad(id);

  if (state.kind === "loading") return <ElectionResultsSkeleton />;
  if (state.kind === "disabled") return <ComingSoon electionId={id} />;
  if (state.kind === "error") {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-2xl px-4 py-12">
          <div className="rounded-xl border border-error/30 bg-error/10 p-6 text-center">
            <p className="text-sm font-medium text-error">{state.message}</p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={reload}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
              >
                Retry
              </button>
              <BackButton fallbackLabel="Back to Elections" fallbackHref="/elections" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  return <LoadedResults electionId={id} initialData={state.data} />;
}

function LoadedResults({
  electionId,
  initialData,
}: {
  electionId: string;
  initialData: ElectionResultsResponse;
}) {
  const [simScript, setSimScript] = useState<SimulationScript | null>(null);
  const [simProgress, setSimProgress] = useState(0);
  const simTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data, lastFetchedAt } = useElectionNightPoll(
    electionId,
    initialData,
    simScript != null // pause polling while simulating
  );

  const stopSimulation = useCallback(() => {
    if (simTimer.current) clearInterval(simTimer.current);
    simTimer.current = null;
    setSimScript(null);
    setSimProgress(0);
  }, []);

  const startSimulation = useCallback(() => {
    // Seed from the clock so every run plays a different night.
    setSimScript(buildSimulationScript(data, Date.now() % 2_147_483_647));
    setSimProgress(0);
    if (simTimer.current) clearInterval(simTimer.current);
    simTimer.current = setInterval(() => {
      setSimProgress((p) => {
        const next = p + SIM_STEP;
        if (next >= 1 && simTimer.current) {
          clearInterval(simTimer.current);
          simTimer.current = null;
        }
        return Math.min(1, next);
      });
    }, SIM_TICK_MS);
  }, [data]);

  useEffect(() => {
    return () => {
      if (simTimer.current) clearInterval(simTimer.current);
    };
  }, []);

  const displayed = simScript ? simulationFrame(simScript, simProgress) : data;

  return (
    <LiveResultsShell
      data={displayed}
      lastFetchedAt={lastFetchedAt}
      simulating={simScript != null}
      onStartSimulation={startSimulation}
      onStopSimulation={stopSimulation}
    />
  );
}

function ComingSoon({ electionId }: { electionId: string }) {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-xl border border-card-border bg-card p-8 text-center">
          <p className="text-lg font-semibold">Live results are coming soon</p>
          <p className="mt-2 text-sm text-muted">
            The election-night results dashboard isn&apos;t switched on for this world yet.
          </p>
          <div className="mt-5">
            <BackButton
              fallbackLabel="Back to Election"
              fallbackHref={`/elections/${electionId}`}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

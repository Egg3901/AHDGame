"use client";

import { useMemo, useState } from "react";
import { TierSelector } from "@/components/elections/primary/TierSelector";
import { RegistrationInfluenceCard } from "@/components/elections/general/RegistrationInfluenceCard";
import {
  PersuasionDrivers,
  type PersuasionDriverCandidate,
} from "@/components/elections/general/PersuasionDrivers";
import type { DriverDisplayInputs } from "@/lib/elections/computePersuasionDriverDisplay";
import type { GeneralElectionViewModel } from "@/lib/elections/generalViewModel";

/**
 * Per-state drivers for the presidential general: registration influence and
 * persuasion drivers for one state at a time.
 *
 * This used to render its own full `BattlegroundMap` directly above the page's
 * `PresidentialMapWithStateDetail` — two large US maps of the same race, one
 * after the other, with a code comment conceding "the two coexist". The EV map
 * is the canonical one (it carries the electoral votes that decide the race),
 * so the second map is gone and the state picker below drives these panels
 * instead. Every unique feature of the old shell is kept.
 */
export function GeneralElectionShellClient({
  viewModel,
  countryId,
  stateNameById,
  persuasionCandidates,
  persuasionInputs,
}: {
  viewModel: GeneralElectionViewModel;
  countryId: string;
  /** Optional state-id → display-name map. Falls back to id when missing. */
  stateNameById?: Record<string, string>;
  /** Raw candidate list for the interactive PersuasionDrivers card. */
  persuasionCandidates: PersuasionDriverCandidate[];
  /** Driver inputs (funds / incumbency / median voter) for the card. */
  persuasionInputs: DriverDisplayInputs;
}) {
  const allStateIds = useMemo(
    () => Object.keys(viewModel.marginByState).sort(),
    [viewModel.marginByState]
  );
  const closest = viewModel.fiveClosestStates;

  const [selectedStateId, setSelectedStateId] = useState<string | null>(
    () => closest[0] ?? allStateIds[0] ?? null
  );

  const nameFor = (id: string) => stateNameById?.[id] ?? id;
  const stateName = selectedStateId ? nameFor(selectedStateId) : "";

  return (
    <div className="space-y-4">
      <TierSelector countryId={countryId} activeTier="president" />

      <div className="rounded-xl border border-card-border bg-card p-3 sm:p-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
          State drivers
        </div>

        {closest.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {closest.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setSelectedStateId(id)}
                aria-pressed={id === selectedStateId}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  id === selectedStateId
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-card-border bg-background text-muted hover:text-foreground"
                }`}
              >
                {nameFor(id)}
              </button>
            ))}
            <span className="self-center text-[11px] text-muted/60">closest races</span>
          </div>
        )}

        <label className="block">
          <span className="sr-only">Choose a state</span>
          <select
            value={selectedStateId ?? ""}
            onChange={(e) => setSelectedStateId(e.target.value || null)}
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm sm:max-w-xs"
          >
            {allStateIds.map((id) => (
              <option key={id} value={id}>
                {nameFor(id)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedStateId ? (
        <div className="grid gap-4 md:grid-cols-2">
          <RegistrationInfluenceCard
            stateId={selectedStateId}
            stateName={stateName}
            breakdown={viewModel.regBreakdownByState[selectedStateId]}
          />
          <PersuasionDrivers
            stateId={selectedStateId}
            stateName={stateName}
            candidates={persuasionCandidates}
            inputs={persuasionInputs}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-card-border bg-card p-4 text-xs text-muted">
          No state data is available for this election yet.
        </div>
      )}
    </div>
  );
}

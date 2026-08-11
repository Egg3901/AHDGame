"use client";

import { useCallback, useState } from "react";
import { useDebouncedSave } from "@/hooks/useDebouncedSave";
import {
  uncoveredRegions,
  overlappingRegions,
  globalEffectiveness,
  effIntent,
} from "@/lib/military/calc";
import type { MilitaryCommand, CommanderRef, ThreatLevel } from "@/lib/military/types";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictAssignment } from "@/lib/military/assignments";
import { useMilitaryState } from "../useMilitaryState";
import { SectionCard, Tile, Badge } from "../../dossier";
import { CommandRoster } from "./CommandRoster";
import { RegionAssignment } from "./RegionAssignment";
import { CommandDetailPanel } from "./CommandDetailPanel";
import { CreateCommandDialog } from "./CreateCommandDialog";

const EFF_TONE = { success: "up", warn: "warning", error: "down" } as const;

/**
 * The national command builder, embedded in the SecDef Office Commands tab. Owns the
 * shared military state (persisted via the gated commands PUT) and composes the roster,
 * region assignment, and command detail. Read-only when the office has no defense seat.
 */
export function CommandsBuilder({
  commands,
  units,
  commanders,
  conflictAssignments,
  regionThreats,
  conflicts = [],
  countryCode,
  positionId,
}: {
  commands: MilitaryCommand[];
  units: MilitaryUnit[];
  commanders: CommanderRef[];
  conflictAssignments: ConflictAssignment[];
  regionThreats: Record<string, ThreatLevel>;
  /** The live conflicts a general can be posted to. Empty until one breaks out. */
  conflicts?: { id: string; name: string }[];
  countryCode: string;
  positionId: string;
}) {
  const {
    state,
    dispatch,
    unitsById,
    pool,
    saveError: commandsSaveError,
  } = useMilitaryState({
    commands,
    units,
    countryCode,
    positionId,
  });
  const canWrite = !!positionId;
  const [assignments, setAssignments] = useState<ConflictAssignment[]>(conflictAssignments);
  const [createOpen, setCreateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const selected = state.commands.find((c) => c.id === state.selectedId) ?? null;

  // The Assign-Regions modal wraps the rich region panel for the selected command:
  // clicking a region inspects it (threat/coverage/stats), and the detail carries the
  // Assign/Remove button. A quick-toggle switches to bulk IN/OUT clicking. Closing
  // clears any inspected region and leaves quick-toggle off.
  const openAssign = () => setAssignOpen(true);
  const closeAssign = () => {
    if (state.assignMode) dispatch({ type: "TOGGLE_ASSIGN_MODE" });
    dispatch({ type: "CLOSE_REGION" });
    setAssignOpen(false);
  };
  const commandersById = Object.fromEntries(commanders.map((c) => [c.id, c]));

  // Persist only the assignments half of the org doc — the Combat Command page owns
  // roles, and sending an empty `positions` here would wipe them.
  const saveError = useDebouncedSave(
    `/api/country/${countryCode}/executive/cabinet/${positionId}/formations`,
    { conflictAssignments: assignments },
    canWrite,
    "Posting changes could not be saved."
  );

  /** Post a general to a Conflict (or unpost them). */
  const setPosting = useCallback((generalCharacterId: string, theaterId: string | null) => {
    setAssignments((prev) => {
      const rest = prev.filter((a) => a.generalCharacterId !== generalCharacterId);
      if (!theaterId) return rest;
      const existing = prev.find((a) => a.generalCharacterId === generalCharacterId);
      return [
        ...rest,
        {
          theaterId,
          generalCharacterId,
          // Moving fronts never carries a command with it.
          inCharge: existing?.theaterId === theaterId ? existing.inCharge : false,
        },
      ];
    });
  }, []);

  /** Put a general in charge of their Conflict, demoting whoever held it. */
  const setInCharge = useCallback((generalCharacterId: string) => {
    setAssignments((prev) => {
      const me = prev.find((a) => a.generalCharacterId === generalCharacterId);
      if (!me) return prev;
      return prev.map((a) =>
        a.theaterId === me.theaterId
          ? { ...a, inCharge: a.generalCharacterId === generalCharacterId }
          : a
      );
    });
  }, []);

  const uncovered = uncoveredRegions(state).length;
  const overlap = overlappingRegions(state).length;
  const globalEff = globalEffectiveness(state, unitsById);

  return (
    <div className="space-y-4">
      {/* Autosave re-sends the whole slice, so one dropped write self-heals — but a
          standing refusal would discard every later edit silently. Say so. */}
      {(saveError || commandsSaveError) && (
        <p role="alert" className="text-[11px] text-error">
          {saveError ?? commandsSaveError}
        </p>
      )}
      <SectionCard
        title="Theater commands"
        sub="Organization of national military responsibility across the world"
        right={
          canWrite ? (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="rounded-lg bg-[var(--gov)] px-3 py-2 text-[12px] font-bold text-[#1a1200] hover:brightness-110"
            >
              ＋ Create command
            </button>
          ) : (
            <Badge tone="muted">Read-only</Badge>
          )
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-card-border rounded-lg border border-card-border">
          <Tile label="Commands" value={String(state.commands.length)} tone="gov" />
          <Tile
            label="Unassigned regions"
            value={String(uncovered)}
            tone={uncovered ? "warning" : "up"}
          />
          <Tile
            label="Global effectiveness"
            value={`${globalEff}%`}
            tone={EFF_TONE[effIntent(globalEff)]}
          />
        </div>
        {overlap > 0 && (
          <div className="mt-3">
            <Badge tone="warning">
              {overlap} region{overlap === 1 ? "" : "s"} with two commands of the same type
            </Badge>
          </div>
        )}
        {/* Where this page stops. Authority over a war is split across three seats and
            nothing said so, which produced the question "where do I assign more troops
            to the battlefield as SoD?" — a question with no button, because units are
            never sent to a front directly. */}
        <div className="mt-3 rounded-lg border border-card-border bg-card-elevated p-3 text-[11px] leading-relaxed text-muted">
          <span className="font-semibold text-foreground">How your troops reach a front.</span> You
          build the force here — commands, the units in them, and each command&rsquo;s Commanding
          General. You do not send units to a war directly. A unit is wherever the general it is
          assigned to is posted, and it is that command&rsquo;s{" "}
          <a
            href={`/country/${countryCode}/general/commands`}
            className="font-semibold text-foreground underline decoration-dotted underline-offset-2 hover:text-gov-soft"
            title="The Commanding General's own page, where postings are made"
          >
            Commanding General
          </a>{" "}
          who posts generals to a conflict and names one of them Theater Commander. Assign a unit to
          a general here; it arrives at the front when that general does.
        </div>
      </SectionCard>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="lg:w-[300px] lg:shrink-0">
          <SectionCard title="Command roster" sub="Select a command to review or edit">
            <CommandRoster
              commands={state.commands}
              selectedId={state.selectedId}
              unitsById={unitsById}
              commandersById={commandersById}
              onSelect={(id) => dispatch({ type: "SELECT", commandId: id })}
            />
          </SectionCard>
        </div>
        <div className="min-w-0 flex-1">
          {selected ? (
            <CommandDetailPanel
              command={selected}
              state={state}
              unitsById={unitsById}
              pool={pool}
              commanders={commanders}
              commandersById={commandersById}
              regionThreats={regionThreats}
              assignments={assignments}
              conflicts={conflicts}
              countryCode={countryCode}
              onSetPosting={setPosting}
              onSetInCharge={setInCharge}
              dispatch={dispatch}
              canWrite={canWrite}
              onAssignRegions={openAssign}
            />
          ) : (
            <SectionCard title="Command detail" sub="Select a command from the roster">
              <p className="text-[12px] text-muted">No command selected.</p>
            </SectionCard>
          )}
        </div>
      </div>

      {createOpen && (
        <CreateCommandDialog
          state={state}
          commanders={commanders}
          onClose={() => setCreateOpen(false)}
          onCreate={(draft) => {
            dispatch({ type: "CREATE_COMMAND", draft });
            setCreateOpen(false);
          }}
        />
      )}

      {assignOpen && selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={`Assign regions to ${selected.name}`}
          onClick={closeAssign}
        >
          <div
            className="flex max-h-[calc(100dvh-4rem)] w-full max-w-xl flex-col rounded-xl border border-card-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-card-border p-5">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-foreground">
                  Assign regions
                </div>
                <div className="dossier-label text-muted">{selected.name}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "TOGGLE_ASSIGN_MODE" })}
                    aria-pressed={state.assignMode}
                    className={`rounded-md border px-2.5 py-1.5 text-[11px] font-semibold ${
                      state.assignMode
                        ? "border-[var(--gov)] bg-[color-mix(in_srgb,var(--gov)_15%,transparent)] text-gov-soft"
                        : "border-card-border text-muted hover:text-foreground"
                    }`}
                  >
                    Quick toggle
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeAssign}
                  className="rounded-lg bg-[var(--gov)] px-4 py-2 text-[12px] font-bold text-[#1a1200]"
                >
                  Done
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <RegionAssignment
                state={state}
                dispatch={dispatch}
                canWrite={canWrite}
                regionThreats={regionThreats}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

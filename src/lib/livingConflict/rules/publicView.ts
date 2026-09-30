/**
 * Living crises show their current participants, pressure and public decisions.
 * The public view omits unrevealed covert commitments and offers only authored
 * transitions from the current phase and lifecycle.
 */
import type { Crisis, CrisisInteraction } from "@/lib/db/types/crisis";
import type { LivingConflictDef, LivingConflictState } from "../types";
import { normalizeConflictState, phaseFor } from "../engine";
import { resolveConflictParticipants } from "./participants";

export interface PublicConflictWindow {
  crisis: Pick<Crisis, "_id" | "name" | "livingConflictEventId" | "globalResponse">;
  interaction?: Pick<CrisisInteraction, "currentNodeId" | "resolvedAt" | "leaderResponses">;
}

export function publicLivingConflictView(
  def: LivingConflictDef,
  row: LivingConflictState,
  countries: ReadonlySet<string>,
  windows: PublicConflictWindow[],
  year: number,
  countryName: (id: string) => string
) {
  const state = normalizeConflictState(def, row);
  const phase = phaseFor(def, state.phaseLevel);
  if (!phase) return null;
  const participants = resolveConflictParticipants(def, countries);
  const responses = windows.filter(
    ({ crisis }) =>
      crisis.globalResponse?.conflictKey === def.key ||
      crisis.livingConflictEventId?.startsWith(`${def.key}:`)
  );
  return {
    key: def.key,
    name: def.name,
    phase: phase.label,
    status: state.status!,
    summary: phase.summary,
    participants: [
      ...new Set([
        ...participants.belligerents,
        ...(participants.backerA ? [participants.backerA] : []),
        ...(participants.backerB ? [participants.backerB] : []),
        ...participants.neighbors,
        ...participants.blocMembers,
      ]),
    ].map(countryName),
    localActors: (participants.representedActors ?? []).map((actor) => actor.name),
    nextPhases: [
      ...new Set(
        (def.transitions ?? [])
          .filter(
            (transition) =>
              transition.fromPhase === phase.key &&
              (!transition.fromStatus || transition.fromStatus === state.status) &&
              (transition.latestYear === undefined || year <= transition.latestYear)
          )
          .map((transition) => def.phases.find((item) => item.key === transition.toPhase)?.label)
          .filter((label): label is string => Boolean(label))
      ),
    ],
    tracks: Object.entries(state.tracks ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({
        key,
        label: key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
        value,
      })),
    decisions: responses
      .filter(({ interaction }) => interaction?.currentNodeId && !interaction.resolvedAt)
      .map(({ crisis }) => ({ id: crisis._id.toString(), title: crisis.name })),
    commitments: responses.flatMap(({ interaction }) =>
      (interaction?.leaderResponses ?? [])
        .filter((response) => response.visibility !== "covert" || response.revealedAt)
        .map((response) => ({
          country: countryName(response.countryId),
          choice: response.optionLabel,
        }))
    ),
    pressures: (def.scheduledPressures ?? [])
      .filter(
        (pressure) =>
          (pressure.fromYear === undefined || year >= pressure.fromYear) &&
          (pressure.untilYear === undefined || year <= pressure.untilYear) &&
          (!pressure.phaseKeys?.length || pressure.phaseKeys.includes(phase.key))
      )
      .map((pressure) => pressure.key.replace(/_/g, " ")),
  };
}
export type LivingConflictView = NonNullable<ReturnType<typeof publicLivingConflictView>>;

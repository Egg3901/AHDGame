import type { MilitaryCommand } from "./types";
import type { ConflictAssignment } from "./assignments";

/**
 * Unwire a dismissed general from the chain of command. Pure.
 *
 * A dismissed general must not be left holding anything: they leave every command's
 * roster, and any command they *led* loses its lead — a command whose
 * `commandingGeneralId` is not one of its `commanderIds` violates the commands route's
 * own invariant, so both have to move together. Their postings go with them.
 *
 * Nobody is promoted to fill the gap. Dismissing a Theater Commander therefore vacates
 * that front; authority falls back to the defense holder (`canActAtTheater` already
 * handles a theater with no TC), so it is never orphaned — but the SecDef has quietly
 * taken the front back and must appoint a successor.
 */
export function applyDismissal(
  commands: MilitaryCommand[],
  assignments: ConflictAssignment[],
  characterId: string
): { commands: MilitaryCommand[]; assignments: ConflictAssignment[] } {
  return {
    commands: commands.map((c) => {
      if (!c.commanderIds.includes(characterId)) return c;
      return {
        ...c,
        commanderIds: c.commanderIds.filter((id) => id !== characterId),
        commandingGeneralId: c.commandingGeneralId === characterId ? null : c.commandingGeneralId,
      };
    }),
    assignments: assignments.filter((a) => a.generalCharacterId !== characterId),
  };
}

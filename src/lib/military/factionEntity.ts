import type { ConflictDoc } from "@/lib/db/types/conflict";

/**
 * Is this id one of THIS conflict's faction entities?
 *
 * A proxy war's belligerents are factions — world entities named by
 * `sideX.factionEntity` — not member countries. They start with empty rosters, so
 * every "is this a real belligerent" check has to admit them, and every "enrol this
 * belligerent into the roster" write has to skip them: a faction IS the side, and
 * listing it inside its own `countries` array would put a non-CountryId into a field
 * the whole belligerent surface reads as one.
 *
 * Exact string match, deliberately. `sideOf` is permissive by design — it places
 * unrostered bloc members by backer — and this must widen nothing: it grants
 * placement to the named faction and to nobody else.
 */
export function isFactionEntity(
  conflict: Pick<ConflictDoc, "sideA" | "sideB">,
  id: string
): boolean {
  return conflict.sideA.factionEntity === id || conflict.sideB.factionEntity === id;
}

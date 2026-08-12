import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";

/**
 * Every entity whose bloc changes when this conflict resolves.
 *
 * The ONE place the `hostEntities ?? [hostCountry]` fallback lives. A missing or empty
 * roster means "just the map anchor" — never "no countries change bloc", which would
 * make the whole resolution outcome a silent no-op on any single-host proxy war and on
 * every conflict document that predates the field.
 */
export function hostEntitiesOf(
  c: Pick<ConflictDoc, "hostCountry" | "hostEntities">
): WorldEntityId[] {
  return c.hostEntities && c.hostEntities.length > 0 ? c.hostEntities : [c.hostCountry];
}

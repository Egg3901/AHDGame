import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import type { CountryId } from "@/lib/constants/countries";
import { MILITARY_BRANCHES_BY_COUNTRY } from "@/lib/constants/military";
import { terrainFamilyOf } from "@/lib/military/combat";

/**
 * Whether a front reaches the sea.
 *
 * Read off `MILITARY_BRANCHES_BY_COUNTRY`, which is already curated for exactly this
 * question and commented as such ("Byelorussia does not, because Byelorussia is
 * landlocked"). Deriving beats a hand-authored field: it needs no migration and it
 * cannot drift from a table the project already maintains.
 *
 * Era gating is deliberately IGNORED. A branch's `dissolvedYear` says when a fleet
 * stood down, not when the coastline moved — Yugoslavia's navy carries 1992 and its
 * coast outlived it. Sea access is geography.
 *
 * A proxy-war host is a FACTION with no row in that table, so those fall back to the
 * ground itself. That fallback applies only when NO host entity is a known country:
 * a landlocked country fighting on delta terrain is still landlocked.
 */
export function deriveSeaAccess(hostEntities: WorldEntityId[], terrain: string): boolean {
  let sawKnownCountry = false;
  for (const id of hostEntities) {
    // Uppercased deliberately: a lowercase id would miss the table and fall through to
    // the terrain guess, which is a WRONG answer rather than an error — a landlocked
    // country on delta ground would silently acquire a coastline.
    const branches = MILITARY_BRANCHES_BY_COUNTRY[String(id).toUpperCase() as CountryId];
    if (!branches) continue;
    sawKnownCountry = true;
    if (branches.some((b) => b.domain === "naval")) return true;
  }
  if (sawKnownCountry) return false;

  const family = terrainFamilyOf(terrain);
  return family === "maritime" || family === "littoral";
}

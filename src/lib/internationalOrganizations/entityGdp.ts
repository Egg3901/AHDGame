/**
 * Live annual GDP for any entity, in USD millions.
 *
 * Playable countries sum their regions. Macro entities have no GDP field at all,
 * but the seed builder derives each sector's per-turn capacity as
 * `annualGdp / MACRO_TURNS_PER_YEAR` — the weights are normalised, so the
 * capacities sum back to exactly that per-turn figure. Multiplying by the same
 * constant inverts it, and reads whatever the macro kernel has since evolved
 * capacity to, which is what makes this current rather than seeded.
 *
 * UNIT TRAP: the result is USD *millions*, matching `loadUsdGdpByCountry`.
 * Anything comparing it against a treasury, a fund balance or an absolute USD
 * spend must multiply by `GDP_MILLIONS_TO_USD` first.
 */
import type { Db } from "mongodb";
import { getMacroCountriesCollection } from "@/lib/db/collections/macroCountries";
import type { CountryId } from "@/lib/constants/countries";
import type { OrgMemberId } from "@/lib/db/types/internationalOrganization";
import { MACRO_TURNS_PER_YEAR } from "@/lib/world/macro/seedBuilder";
import { ALIGNMENT_ROSTER } from "@/lib/constants/alignmentRoster";
import { loadUsdGdpByCountry } from "./countryGdp";

export async function loadGdpUsdMillionsByEntity(
  db: Db,
  entityIds: readonly OrgMemberId[],
  preset?: string
): Promise<Map<OrgMemberId, number>> {
  const out = new Map<OrgMemberId, number>();
  if (entityIds.length === 0) return out;

  // `preset` is threaded through rather than re-read: a caller that already
  // holds it would otherwise pay a `gameState` round-trip per call, and the
  // world-organizations view makes several.
  const playable = await loadUsdGdpByCountry(db, entityIds as CountryId[], preset);
  for (const [id, gdp] of playable) if (gdp > 0) out.set(id, gdp);

  const macros = await (
    await getMacroCountriesCollection(db)
  )
    .find({ entityId: { $in: [...entityIds] } })
    .toArray();
  for (const macro of macros) {
    // A playable figure always wins: if an entity somehow has both, `states` is
    // the one the game simulates and shows.
    if (out.has(macro.entityId)) continue;
    const perTurn = Object.values(macro.sectors ?? {}).reduce(
      (sum, sector) => sum + ((sector as { capacity?: number } | undefined)?.capacity ?? 0),
      0
    );
    if (perTurn > 0) out.set(macro.entityId, perTurn * MACRO_TURNS_PER_YEAR);
  }
  return out;
}

/**
 * Every modelled economy in the world, summed — the denominator for "what share
 * of the world does this bloc hold".
 *
 * The world here is the entities the game actually prices: playable countries
 * and macro-tier ones. Background Nations carry no economy by design, so they
 * are absent from both sides of the ratio rather than counted as zero, which
 * would make every bloc's share shrink as flavour members were added.
 */
export async function loadWorldGdpUsdMillions(db: Db, preset?: string): Promise<number> {
  const all = await loadGdpUsdMillionsByEntity(
    db,
    ALIGNMENT_ROSTER.map((r) => r.key) as readonly OrgMemberId[],
    preset
  );
  let total = 0;
  for (const gdp of all.values()) total += Math.max(0, gdp);
  return total;
}

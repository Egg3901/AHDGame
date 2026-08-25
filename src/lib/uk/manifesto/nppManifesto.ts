import { calcAppeal } from "@/lib/utils/demographicAppeal";
import type { PledgeCatalogEntry } from "@/lib/db/types/manifesto";
import { MANIFESTO_PLEDGE_COUNT } from "@/lib/db/types/manifesto";

/**
 * Auto-generate a manifesto for an AI-controlled party (NPP) — epic #856,
 * ticket #857. Symmetry decision (ops-knowledge `uk-rework-design-2026-08-25`):
 * NPPs get manifestos and are judged on delivery like players, so they must not
 * be left without one.
 *
 * An NPP picks the catalog pledges CLOSEST TO ITS OWN IDEOLOGY (a party
 * campaigns on what it believes), scored with the same `calcAppeal` used for
 * voters. Pure and deterministic: same inputs → same pledges.
 */

/** Score a catalog entry by how well it fits a party's own position. */
export function pledgeFitForParty(
  entry: PledgeCatalogEntry,
  partyEconomic: number,
  partySocial: number
): number {
  return calcAppeal(
    partyEconomic,
    partySocial,
    entry.position.economic,
    entry.position.social,
    0,
    false
  );
}

/**
 * Select an NPP's pledge ids: the top `count` catalog entries by fit to the
 * party's own (economic, social) position. Ties break by catalog id for
 * determinism. Returns fewer than `count` only if the catalog is smaller.
 */
export function selectNppPledges(
  catalog: PledgeCatalogEntry[],
  partyEconomic: number,
  partySocial: number,
  count: number = MANIFESTO_PLEDGE_COUNT
): string[] {
  return [...catalog]
    .map((e) => ({ id: e.id, fit: pledgeFitForParty(e, partyEconomic, partySocial) }))
    .sort((a, b) => b.fit - a.fit || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, count))
    .map((e) => e.id);
}

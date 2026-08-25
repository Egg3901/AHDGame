import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ObjectId } from "mongodb";
import { listManifestosForElection } from "@/lib/db/collections/manifestos";
import { getPledgeCatalogEntry } from "./pledgeCatalog";
import { buildManifestoMultipliers, type GroupLeanWithId } from "./manifestoPopularity";

/**
 * Election-time bridge from locked manifestos → the vote engine's
 * `manifestoMultipliers` option (epic #856, ticket #857).
 *
 * GATED OFF BY DEFAULT. The feature only produces multipliers when the env flag
 * `UK_MANIFESTO_VOTE_EFFECT=1` is set — until then this returns `undefined` and
 * the vote engine falls back to 1.0 (no behaviour change). The flag exists
 * specifically so the balance-sensitive coefficient stays off in prod until it
 * is calibrated in worldsim (the A/B harness is dead). See ops-knowledge
 * `uk-rework-design-2026-08-25`.
 *
 * When off, the env check short-circuits BEFORE any DB read, so this is a no-op
 * on the hot vote-tally path.
 */
export function isManifestoVoteEffectEnabled(): boolean {
  return process.env.UK_MANIFESTO_VOTE_EFFECT === "1";
}

/** Minimal shapes so this stays decoupled from the engine's concrete types. */
interface CategoryLike {
  groups: { id: string; defaultEconomicLean: number; defaultSocialLean: number }[];
}
interface DemographicsLike {
  groups: Record<string, { economicLean?: number; socialLean?: number } | undefined>;
}

/**
 * Derive the per-group lean list the multiplier builder needs, mirroring the
 * engine's fallback (state group lean, else the category default).
 */
export function deriveGroupLeans(
  categories: CategoryLike[],
  demographics: DemographicsLike
): GroupLeanWithId[] {
  const out: GroupLeanWithId[] = [];
  const seen = new Set<string>();
  for (const category of categories) {
    for (const group of category.groups) {
      if (seen.has(group.id)) continue;
      seen.add(group.id);
      const sg = demographics.groups[group.id];
      out.push({
        id: group.id,
        economicLean: sg?.economicLean ?? group.defaultEconomicLean,
        socialLean: sg?.socialLean ?? group.defaultSocialLean,
      });
    }
  }
  return out;
}

/**
 * Build the `manifestoMultipliers` map for an election, or `undefined` when the
 * feature is off / not applicable / no locked manifestos exist.
 */
export async function resolveElectionManifestoMultipliers(
  db: Db,
  args: {
    countryId: CountryId;
    electionId: ObjectId;
    isGeneralElection: boolean;
    groups: GroupLeanWithId[];
  }
): Promise<Record<string, Record<string, number>> | undefined> {
  if (!isManifestoVoteEffectEnabled()) return undefined;
  if (args.countryId !== "UK" || !args.isGeneralElection) return undefined;

  const manifestos = await listManifestosForElection(db, args.countryId, args.electionId);
  const pledgesByParty: Record<string, ReturnType<typeof getPledgeCatalogEntry>[]> = {};
  for (const m of manifestos) {
    if (!m.lockedAt) continue; // only locked manifestos count
    const entries = m.pledges
      .map((p) => getPledgeCatalogEntry(p.catalogEntryId))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
    if (entries.length > 0) pledgesByParty[m.party] = entries;
  }
  if (Object.keys(pledgesByParty).length === 0) return undefined;

  return buildManifestoMultipliers(
    pledgesByParty as Record<string, NonNullable<ReturnType<typeof getPledgeCatalogEntry>>[]>,
    args.groups
  );
}

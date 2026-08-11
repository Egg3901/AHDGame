import { ObjectId, type Db } from "mongodb";
import type { PoliticalParty } from "@/lib/db/types";
import {
  politicalParties as usParties,
  type PartySeed,
} from "@/lib/seeds/reference/politicalParties";
import { ukParties } from "./uk/ukParties";
import { deParties } from "./de/deParties";
import { jpParties } from "./jp/jpParties";
import { brParties } from "./br/brParties";
import { ieParties } from "./ie/ieParties";
import { cnParties } from "./cn/cnParties";
import { resolveSeedPartyTier } from "./defaultPartyTiers";
import { getNextSequentialId } from "@/lib/db/sequentialId";

/**
 * True when this party seed should be created under the given preset.
 * Seeds without an explicit `validForPresets` list are preset-agnostic
 * (the common case).
 */
export function isPartyValidForPreset(seed: PartySeed, preset: string): boolean {
  return !seed.validForPresets || seed.validForPresets.includes(preset);
}

/**
 * Deletes default parties whose seed declares `validForPresets` that excludes
 * the active preset. Country seeders call this before upserting so a reseed
 * self-heals worlds that still carry wrong-era defaults (e.g. MSZMP lingering
 * beside MDP in a 1953 Hungary world). Seeds without `validForPresets` are
 * never pruned (preset-agnostic).
 *
 * @returns Number of party documents deleted
 */
export async function prunePresetMismatchedDefaultParties(
  db: Db,
  seeds: PartySeed[],
  preset: string
): Promise<number> {
  const mismatched = seeds
    .filter((seed) => seed.validForPresets && !seed.validForPresets.includes(preset))
    .map((seed) => ({ countryId: seed.countryId, name: seed.name }));
  if (mismatched.length === 0) return 0;
  const result = await db.collection<PoliticalParty>("politicalParties").deleteMany({
    $or: mismatched.map(({ countryId, name }) => ({
      countryId,
      name,
      isDefault: true,
    })),
  });
  return result.deletedCount ?? 0;
}

/**
 * Ensures all default parties (US, UK, DE, JP, BR, IE, CN) exist in the
 * database. Creates any that are missing without modifying existing ones.
 * Looks up by name+country since slug is no longer used.
 *
 * `preset` filters preset-gated seeds: e.g. UUP / PDS / JSP / DSP / PMDB /
 * PFL / WP / PD are `"1991-default"`-only and Reform UK / AfD / Linke /
 * CDP / Ishin / DPFP / PL / MDB / UNIÃO / SF (IE) / GP (IE) are
 * `"2019-default"`-only. Pass the current `gameState.preset` value;
 * defaults to `"2019-default"` for back-compat.
 *
 * @returns Number of parties created
 */
export async function ensureDefaultParties(db: Db, preset: string): Promise<number> {
  const now = new Date();
  let partiesCreated = 0;

  // Combine, filter by preset, then sort by country/seedOrder
  const allSeeds: PartySeed[] = [
    ...usParties,
    ...ukParties,
    ...deParties,
    ...jpParties,
    ...brParties,
    ...ieParties,
    ...cnParties,
  ]
    .filter((seed) => isPartyValidForPreset(seed, preset))
    .sort((a, b) => {
      if (a.countryId !== b.countryId) return a.countryId.localeCompare(b.countryId);
      return a.seedOrder - b.seedOrder;
    });

  // Check which parties (default OR custom) already use a seed's name+country.
  // We scan ALL parties — not just default — so a pre-existing player-created
  // party that happens to share a name with a preset-gated default (e.g. a
  // player created "Ulster Unionist Party" under 2019-default before the
  // draftCharter reservation guard was added, then admin switches to
  // 1991-default) doesn't end up with a duplicate-name row inserted
  // alongside it. Defensive partner to the reservation in `draftCharter.ts`.
  const existingParties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({})
    .project({ name: 1, countryId: 1, isDefault: 1 })
    .toArray();

  const existingKey = new Set(existingParties.map((p) => `${p.countryId}:${p.name}`));
  const nonDefaultCollisionKey = new Set(
    existingParties.filter((p) => !p.isDefault).map((p) => `${p.countryId}:${p.name}`)
  );

  for (const seed of allSeeds) {
    const key = `${seed.countryId}:${seed.name}`;
    if (existingKey.has(key)) {
      if (nonDefaultCollisionKey.has(key)) {
        console.warn(
          `[ensureDefaultParties] Skipping default-party seed for "${seed.name}" (${seed.countryId}) — name is already held by a non-default party. Resolve manually before the next preset switch.`
        );
      }
      continue;
    }

    const sequentialId = await getNextSequentialId(db, "party", seed.countryId);
    const { seedOrder, validForPresets, ...seedWithoutMeta } = seed;
    void seedOrder;
    void validForPresets;

    const party: PoliticalParty = {
      _id: new ObjectId(),
      sequentialId,
      ...seedWithoutMeta,
      // D5 — seed the Major/Minor tier per the proposal table for this preset
      // (overrides any tier on the seed object). The partyTierTurn phase then
      // keeps it current from live Org.
      tier: resolveSeedPartyTier(seed, preset),
      // 2026-05-22 treasury-two-person-approval: all parties default to
      // double-approval on creation. Seed rows that don't specify this
      // field inherit the new default explicitly so the seeded row in
      // the DB carries it (rather than relying on the route-layer
      // fallback for legacy data).
      transactionApprovalMode: seedWithoutMeta.transactionApprovalMode ?? "double",
      createdAt: now,
      updatedAt: now,
    };

    await db.collection<PoliticalParty>("politicalParties").insertOne(party);
    partiesCreated++;
  }

  return partiesCreated;
}

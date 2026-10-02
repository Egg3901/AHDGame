import { ObjectId, type Db } from "mongodb";
import type { PoliticalParty } from "@/lib/db/types";
import { resolveSeedPartyTier } from "@/lib/seeds/defaultPartyTiers";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { SUCCESSOR_PARTIES_1991 } from "@/lib/seeds/reference/successorParties1991";
import { PARTY_SEED_MODULES } from "@/lib/seeds/partySeedRegistry";
import { prunePresetMismatchedDefaultParties } from "@/lib/seeds/ensureDefaultParties";
import type { CountryId } from "@/lib/constants/countries";

/** Seed only the parties that existed in the January 1991 scenario. */
export async function seedSuccessorParties1991(
  db: Db,
  preset: string,
  log: (message: string) => void
): Promise<void> {
  if (preset !== "1991-default") return;

  // Remove two early draft entries that were founded/renamed after the
  // scenario's January start. Keep player-created parties with these names.
  await db.collection<PoliticalParty>("politicalParties").deleteMany({
    isDefault: true,
    $or: [
      { countryId: "RU", name: "Liberal Democratic Party of the Soviet Union" },
      { countryId: "YU", name: "Democratic Party of Socialists of Montenegro" },
    ],
  });

  for (const countryId of Object.keys(SUCCESSOR_PARTIES_1991) as CountryId[]) {
    const roster = SUCCESSOR_PARTIES_1991[countryId] ?? [];
    const legacy = PARTY_SEED_MODULES[countryId] ?? [];
    await prunePresetMismatchedDefaultParties(db, [...legacy, ...roster], preset);
    let seeded = 0;
    for (const party of roster) {
      const { seedOrder: _seedOrder, validForPresets: _validForPresets, ...partyData } = party;
      void _seedOrder;
      void _validForPresets;
      const existing = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ name: party.name, countryId });
      if (existing && !existing.isDefault) {
        log(`[${countryId}] existing player party owns ${party.name}; skipped 1991 default`);
        continue;
      }
      if (existing) {
        await db.collection<PoliticalParty>("politicalParties").updateOne(
          { _id: existing._id },
          {
            $set: {
              ...partyData,
              tier: resolveSeedPartyTier(party, preset),
              updatedAt: new Date(),
            },
          }
        );
      } else {
        const sequentialId = await getNextSequentialId(db, "party", countryId);
        await db.collection<PoliticalParty>("politicalParties").insertOne({
          _id: new ObjectId(),
          sequentialId,
          ...partyData,
          tier: resolveSeedPartyTier(party, preset),
          transactionApprovalMode: partyData.transactionApprovalMode ?? "double",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as PoliticalParty);
      }
      seeded++;
    }
    log(`[${countryId}] seeded ${seeded} January 1991 political organizations`);
  }
}

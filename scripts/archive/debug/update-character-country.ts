import { getDb } from "../src/lib/mongodb";
import { ObjectId } from "mongodb";

/**
 * Update a character's countryId and homeState to UK
 * Usage: npx tsx scripts/update-character-country.ts <characterId> <ukRegionId>
 * Example: npx tsx scripts/update-character-country.ts 507f1f77bcf86cd799439011 UK_LON
 */

async function updateCharacterCountry() {
  const characterId = process.argv[2];
  const ukRegion = process.argv[3];

  if (!characterId) {
    console.error("Usage: npx tsx scripts/update-character-country.ts <characterId> <ukRegionId>");
    console.error(
      "Example: npx tsx scripts/update-character-country.ts 507f1f77bcf86cd799439011 UK_LON"
    );
    console.error(
      "\nAvailable UK regions: UK_LON, UK_SEE, UK_SWE, UK_EM, UK_WM, UK_YHU, UK_NW, UK_NE, UK_WAL, UK_SCO, UK_NI"
    );
    process.exit(1);
  }

  const db = await getDb();

  // Find character
  const character = await db.collection("characters").findOne({
    _id: new ObjectId(characterId),
  });

  if (!character) {
    console.error(`Character ${characterId} not found`);
    process.exit(1);
  }

  console.log("Current character:");
  console.log("  Name:", character.name);
  console.log("  CountryId:", character.countryId ?? "US (default)");
  console.log("  HomeState:", character.homeState);

  // Update to UK
  const updates: any = {
    countryId: "UK",
    updatedAt: new Date(),
  };

  if (ukRegion) {
    updates.homeState = ukRegion;
  }

  await db
    .collection("characters")
    .updateOne({ _id: new ObjectId(characterId) }, { $set: updates });

  console.log("\n✓ Updated character to:");
  console.log("  CountryId: UK");
  if (ukRegion) {
    console.log("  HomeState:", ukRegion);
  }
  console.log("\nYou can now enter UK elections!");

  process.exit(0);
}

updateCharacterCountry();

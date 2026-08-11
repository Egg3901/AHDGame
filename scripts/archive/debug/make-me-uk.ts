import { getDb } from "../src/lib/mongodb";

/**
 * Update your character to UK
 * Usage: npx tsx scripts/make-me-uk.ts <username> <ukRegionId>
 * Example: npx tsx scripts/make-me-uk.ts myusername UK_LON
 *
 * Available UK regions:
 * - UK_LON (London)
 * - UK_SEE (South East England)
 * - UK_SWE (South West England)
 * - UK_EM (East Midlands)
 * - UK_WM (West Midlands)
 * - UK_YHU (Yorkshire and the Humber)
 * - UK_NW (North West)
 * - UK_NE (North East)
 * - UK_WAL (Wales)
 * - UK_SCO (Scotland)
 * - UK_NI (Northern Ireland)
 */

async function makeUserUK() {
  const username = process.argv[2];
  const ukRegion = process.argv[3] || "UK_LON"; // Default to London

  if (!username) {
    console.error("Usage: npx tsx scripts/make-me-uk.ts <username> <ukRegionId>");
    console.error("Example: npx tsx scripts/make-me-uk.ts myusername UK_LON");
    console.error(
      "\nAvailable UK regions: UK_LON, UK_SEE, UK_SWE, UK_EM, UK_WM, UK_YHU, UK_NW, UK_NE, UK_WAL, UK_SCO, UK_NI"
    );
    process.exit(1);
  }

  const validRegions = [
    "UK_LON",
    "UK_SEE",
    "UK_SWE",
    "UK_EM",
    "UK_WM",
    "UK_YHU",
    "UK_NW",
    "UK_NE",
    "UK_WAL",
    "UK_SCO",
    "UK_NI",
  ];
  if (!validRegions.includes(ukRegion)) {
    console.error(`Invalid UK region: ${ukRegion}`);
    console.error("Valid regions:", validRegions.join(", "));
    process.exit(1);
  }

  const db = await getDb();

  // Find user
  const user = await db.collection("users").findOne({ username });
  if (!user) {
    console.error(`User '${username}' not found`);
    process.exit(1);
  }

  // Find character
  const character = await db.collection("characters").findOne({ userId: user._id });
  if (!character) {
    console.error(`No character found for user '${username}'`);
    process.exit(1);
  }

  console.log("Current character:");
  console.log("  Name:", character.name);
  console.log("  CountryId:", character.countryId ?? "US (default)");
  console.log("  HomeState:", character.homeState);

  // Update to UK
  const result = await db.collection("characters").updateOne(
    { _id: character._id },
    {
      $set: {
        countryId: "UK",
        homeState: ukRegion,
        updatedAt: new Date(),
      },
    }
  );

  if (result.modifiedCount > 0) {
    console.log("\n✓ Successfully updated character to:");
    console.log("  CountryId: UK");
    console.log("  HomeState:", ukRegion);
    console.log("\nYou can now enter UK elections!");
  } else {
    console.log("\n⚠ No changes made (character may already be UK)");
  }

  process.exit(0);
}

makeUserUK();

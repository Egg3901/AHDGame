import { connectDb, closeDb } from "../utils/db";
import { STATE_IDS } from "../../src/lib/constants/states";
import type { DemographicModifiers, StateDemographicTurnout } from "../../src/lib/db/types";

function createEmptyModifiers(): DemographicModifiers {
  return {
    race: { white: 0, black: 0, hispanic: 0, asian: 0, other: 0 },
    age: { young: 0, mid: 0, mature: 0, senior: 0 },
    education: { no_college: 0, college: 0, graduate: 0 },
    wealth: { low: 0, middle: 0, high: 0 },
    ideology: {
      evangelicals: 0,
      environmentalists: 0,
      libertarians: 0,
      progressives: 0,
      patriots: 0,
      gunowners: 0,
    },
  };
}

async function seedStateDemographicTurnout() {
  const db = await connectDb();

  try {
    const collection = db.collection<StateDemographicTurnout>("stateDemographicTurnout");

    // Clear existing data
    await collection.deleteMany({});

    const now = new Date();
    // Include all 50 states + DC
    const stateIds = [...STATE_IDS, "DC"];

    const documents = stateIds.map((stateId) => ({
      _id: stateId,
      countryId: "US" as const,
      modifiers: createEmptyModifiers(),
      lastDecayApplied: now,
      lastUpdated: now,
    }));

    await collection.insertMany(documents);

    console.log(`✅ Seeded ${documents.length} states with demographic turnout data`);
  } finally {
    await closeDb();
  }
}

seedStateDemographicTurnout()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error seeding data:", error);
    process.exit(1);
  });

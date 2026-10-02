import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { StateDemographics, StateDemographicTurnout } from "@/lib/db/types";

/** Fill missing policy baselines and neutral turnout rows after every country pack. */
export async function ensureDemographicBaselines(db: Db, log: (message: string) => void) {
  const demographics = await db
    .collection<StateDemographics>("stateDemographics")
    .find({})
    .toArray();
  const now = new Date();
  const baselineOps: AnyBulkWriteOperation<StateDemographics>[] = demographics.map((document) => {
    const { _id, ...baseline } = document;
    return {
      updateOne: {
        filter: { _id },
        update: { $setOnInsert: baseline },
        upsert: true,
      },
    };
  });
  const turnoutOps: AnyBulkWriteOperation<StateDemographicTurnout>[] = demographics.map(
    (document) => ({
      updateOne: {
        filter: { _id: document._id },
        update: {
          $set: { countryId: document.countryId },
          $setOnInsert: {
            modifiers: {},
            lastDecayApplied: now,
            lastUpdated: now,
          },
        },
        upsert: true,
      },
    })
  );
  if (baselineOps.length > 0) {
    await db.collection<StateDemographics>("demographicDefaults").bulkWrite(baselineOps);
    await db.collection<StateDemographicTurnout>("stateDemographicTurnout").bulkWrite(turnoutOps);
  }
  log(`Ensured demographic baselines and turnout rows for ${demographics.length} regions`);
}

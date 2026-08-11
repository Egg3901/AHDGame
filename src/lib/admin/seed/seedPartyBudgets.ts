import { ObjectId, type Db } from "mongodb";
import type { PartyBudget, PoliticalParty, State } from "@/lib/db/types";

export async function seedPartyBudgets(db: Db, reset: boolean, log: (msg: string) => void) {
  const collection = db.collection<PartyBudget>("partyBudget");

  if (reset) {
    await collection.deleteMany({});
    log("Cleared partyBudget collection");
  }

  const [parties, states] = await Promise.all([
    db
      .collection<PoliticalParty>("politicalParties")
      .find({ isDefault: true })
      .project({ sequentialId: 1, countryId: 1 })
      .toArray(),
    db
      .collection<State>("states")
      .find({ _id: { $not: /^NATIONAL_/ } })
      .project({ _id: 1, countryId: 1 })
      .toArray(),
  ]);

  const now = new Date();
  const operations = parties.flatMap((party) => {
    const nationalBudget: PartyBudget = {
      _id: new ObjectId(),
      partyId: String(party.sequentialId),
      countryId: party.countryId,
      scope: "national",
      gotvBudgetPerTurn: 0,
      gotvBudgetPercent: 0,
      suppressionBudgetPercent: 0,
      orgBuildingPercent: 0,
      createdAt: now,
      updatedAt: now,
    };
    const { updatedAt: nationalUpdatedAt, ...nationalBudgetOnInsert } = nationalBudget;

    const stateBudgets = states
      .filter((state) => state.countryId === party.countryId)
      .map((state) => {
        const stateBudgetOnInsert = {
          _id: new ObjectId(),
          partyId: String(party.sequentialId),
          countryId: party.countryId,
          scope: "state" as const,
          stateId: state._id,
          gotvBudgetPerTurn: 0,
          gotvBudgetPercent: 0,
          suppressionBudgetPercent: 0,
          orgBuildingPercent: 0,
          createdAt: now,
        };

        return {
          updateOne: {
            filter: {
              partyId: String(party.sequentialId),
              countryId: party.countryId,
              scope: "state" as const,
              stateId: state._id,
            },
            update: {
              $set: { updatedAt: now },
              $setOnInsert: stateBudgetOnInsert,
            },
            upsert: true,
          },
        };
      });

    return [
      {
        updateOne: {
          filter: {
            partyId: String(party.sequentialId),
            countryId: party.countryId,
            scope: "national" as const,
          },
          update: {
            $set: { updatedAt: now },
            $setOnInsert: nationalBudgetOnInsert,
          },
          upsert: true,
        },
      },
      ...stateBudgets,
    ];
  });

  if (operations.length > 0) {
    await collection.bulkWrite(operations, { ordered: false });
  }

  await collection.createIndex(
    { countryId: 1, partyId: 1, scope: 1, stateId: 1 },
    { unique: true }
  );
  await collection.createIndex({ partyId: 1, scope: 1, stateId: 1 });

  log(`Seeded party budgets for ${parties.length} default parties across ${states.length} states`);
}

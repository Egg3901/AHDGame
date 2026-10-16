import { ObjectId } from "mongodb";
import type { Migration } from "../types";
import { SCOTUS_ACHIEVEMENTS, SCOTUS_CONFIRMED_SLUG } from "@/lib/scotus/achievementDefinitions";
import {
  buildScotusConfirmationCareerEvent,
  hasScotusConfirmationEvent,
} from "@/lib/scotus/careerEvents";
import type { CareerEvent } from "@/lib/db/types/character";

/**
 * Adds the Supreme Court achievement definitions and backfills what past
 * confirmations should already have produced: a career-history entry and the
 * "confirmed" achievement for each player nominee. Deaths in office are not
 * backfilled, since a vacated seat does not record its cause.
 */
export const migration: Migration = {
  id: "2026-10-16-scotus-career-achievements",
  description: "Seed Supreme Court achievements and backfill confirmed justices' career history.",
  idempotent: true,
  async execute(db, ctx) {
    const confirmed = await db
      .collection("scotusNominations")
      .find(
        { status: "confirmed", nomineeMode: "character", nomineeCharacterId: { $ne: null } },
        {
          projection: {
            countryId: 1,
            seatNumber: 1,
            nomineeCharacterId: 1,
            nomineeParty: 1,
            confirmedAt: 1,
            updatedAt: 1,
          },
        }
      )
      .toArray();
    const characters = confirmed.length
      ? await db
          .collection("characters")
          .find(
            { _id: { $in: confirmed.map((n) => n.nomineeCharacterId as ObjectId) } },
            { projection: { userId: 1, careerHistory: 1 } }
          )
          .toArray()
      : [];
    const byId = new Map(characters.map((c) => [c._id.toString(), c]));

    const historyWrites: Array<{
      updateOne: { filter: { _id: ObjectId }; update: { $push: { careerHistory: CareerEvent } } };
    }> = [];
    const awardUserIds = new Map<string, { userId: ObjectId; characterId: ObjectId }>();
    for (const nom of confirmed) {
      const character = byId.get((nom.nomineeCharacterId as ObjectId).toString());
      if (!character) continue;
      if (!hasScotusConfirmationEvent(character.careerHistory, nom.seatNumber)) {
        historyWrites.push({
          updateOne: {
            filter: { _id: character._id },
            update: {
              $push: {
                careerHistory: buildScotusConfirmationCareerEvent({
                  seatNumber: nom.seatNumber,
                  party: nom.nomineeParty,
                  partyCountryId: nom.countryId,
                  date: nom.confirmedAt ?? nom.updatedAt ?? new Date(),
                }),
              },
            },
          },
        });
      }
      if (character.userId) {
        awardUserIds.set(character.userId.toString(), {
          userId: character.userId,
          characterId: character._id,
        });
      }
    }

    if (!ctx.dryRun) {
      const now = new Date();
      await db.collection("achievements").bulkWrite(
        SCOTUS_ACHIEVEMENTS.map((definition) => ({
          updateOne: {
            filter: { slug: definition.slug },
            update: { $setOnInsert: { ...definition, createdAt: now, updatedAt: now } },
            upsert: true,
          },
        }))
      );
      if (historyWrites.length) await db.collection("characters").bulkWrite(historyWrites);
      const definition = await db
        .collection("achievements")
        .findOne({ slug: SCOTUS_CONFIRMED_SLUG }, { projection: { _id: 1 } });
      if (definition && awardUserIds.size) {
        await db.collection("characterAchievements").bulkWrite(
          [...awardUserIds.values()].map(({ userId, characterId }) => ({
            updateOne: {
              filter: { userId, achievementId: definition._id },
              update: {
                $setOnInsert: {
                  _id: new ObjectId(),
                  userId,
                  characterId,
                  achievementId: definition._id,
                  earnedAt: now,
                },
              },
              upsert: true,
            },
          }))
        );
      }
    }
    return {
      documentsScanned: confirmed.length,
      documentsUpdated: historyWrites.length,
      notes: [`${awardUserIds.size} justices checked for the confirmed achievement`],
    };
  },
};

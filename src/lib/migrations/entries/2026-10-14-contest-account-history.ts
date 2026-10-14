import { loadCareerLegislation, archiveRetiredCareerLegislation } from "@/lib/world/careerEvidence";
import { ObjectId } from "mongodb";
import type { Migration } from "../types";
import { getContestRoundsCollection } from "@/lib/contests/collection";
import { CONTEST_ACHIEVEMENTS } from "@/lib/contests/achievementDefinitions";

/** Only establish ownership from recorded identities, never from a name match. */
export const migration: Migration = {
  id: "2026-10-14-contest-account-history",
  description: "Preserve contest account ownership, seed contest achievements and history indexes.",
  idempotent: true,
  async execute(db, ctx) {
    const [live, retired, rounds] = await Promise.all([
      db
        .collection("characters")
        .find({ userId: { $exists: true } }, { projection: { userId: 1 } })
        .toArray(),
      db
        .collection("retiredCharacters")
        .find({}, { projection: { characterId: 1, userId: 1 } })
        .toArray(),
      getContestRoundsCollection(db)
        .find({}, { projection: { standings: 1, winners: 1, kind: 1 } })
        .toArray(),
    ]);
    const owners = new Map<string, string>();
    for (const c of live) owners.set(c._id.toString(), c.userId.toString());
    for (const c of retired)
      if (c.characterId && c.userId) owners.set(c.characterId.toString(), c.userId.toString());
    const updates = rounds.flatMap((round) => {
      const set: Record<string, string> = {};
      for (const field of ["standings", "winners"] as const) {
        round[field].forEach((entry, index) => {
          if (entry.userId) return;
          const owner =
            round.kind.startsWith("referrals_") && ObjectId.isValid(entry.subjectId)
              ? entry.subjectId
              : owners.get(entry.characterId);
          if (owner) set[`${field}.${index}.userId`] = owner;
        });
      }
      return Object.keys(set).length
        ? [{ updateOne: { filter: { _id: round._id }, update: { $set: set } } }]
        : [];
    });
    if (!ctx.dryRun) {
      await archiveRetiredCareerLegislation(db, await loadCareerLegislation(db));
      if (updates.length) await getContestRoundsCollection(db).bulkWrite(updates);
      const now = new Date();
      await db.collection("achievements").bulkWrite(
        CONTEST_ACHIEVEMENTS.map((definition, index) => ({
          updateOne: {
            filter: { slug: definition.slug },
            update: {
              $setOnInsert: {
                ...definition,
                icon: "Trophy",
                category: "milestone",
                triggerType: "contest_result",
                isHidden: false,
                order: 600 + index,
                createdAt: now,
                updatedAt: now,
              },
            },
            upsert: true,
          },
        }))
      );
      await getContestRoundsCollection(db).createIndex(
        { status: 1, "standings.userId": 1, settledAt: -1 },
        { name: "contestRounds_account_history" }
      );
      await getContestRoundsCollection(db).createIndex(
        { status: 1, "winners.userId": 1 },
        { name: "contestRounds_account_winners" }
      );
      await getContestRoundsCollection(db).createIndex(
        { status: 1, settledAt: -1 },
        { name: "contestRounds_settled" }
      );
    }
    return {
      documentsScanned: rounds.length,
      documentsUpdated: ctx.dryRun ? 0 : updates.length,
      notes: [
        `${ctx.dryRun ? "Would link" : "Linked"} ${updates.length} rounds; unresolved historical owners remain unassigned.`,
      ],
    };
  },
};

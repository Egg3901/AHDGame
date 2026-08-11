import type { Db } from "mongodb";
import type { Character, ElectedOfficial, Notification } from "@/lib/db/types";

export function isFilledOfficial(official: Pick<ElectedOfficial, "characterId" | "nppId"> | null) {
  return Boolean(official?.characterId || official?.nppId);
}

export async function notifyGovernorOfSenateVacancy(
  db: Db,
  state: string | undefined,
  senateClass: 1 | 2 | 3 | undefined
): Promise<void> {
  if (!state || !senateClass) return;

  const governorOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    officeType: "governor",
    state,
    characterId: { $ne: null },
  });

  if (!governorOfficial?.characterId) return;

  const governorChar = await db.collection<Character>("characters").findOne({
    _id: governorOfficial.characterId,
  });

  if (!governorChar?.userId) return;

  await db.collection<Omit<Notification, "_id">>("notifications").insertOne({
    userId: governorChar.userId,
    title: "Senate Seat Vacant",
    message: `A Senate seat in ${state} (Class ${senateClass}) has become vacant. You may appoint a replacement.`,
    type: "system",
    read: false,
    metadata: {
      officeType: "senate",
      state,
      senateClass,
    },
    createdAt: new Date(),
  });
}

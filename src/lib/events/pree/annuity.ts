import type { Db } from "mongodb";
import type { Character } from "@/lib/db/types/character";

/** Credit one turn of lottery annuity PI and decrement the counter. */
export async function processLotteryAnnuities(db: Db): Promise<number> {
  const chars = await db
    .collection<Character>("characters")
    .find({ "preeLotteryAnnuity.turnsRemaining": { $gt: 0 } })
    .toArray();

  let processed = 0;
  for (const character of chars) {
    const annuity = character.preeLotteryAnnuity;
    if (!annuity || annuity.turnsRemaining <= 0) {
      continue;
    }
    await db.collection<Character>("characters").updateOne(
      { _id: character._id },
      {
        $inc: { politicalInfluence: annuity.piPerTurn },
        $set: {
          preeLotteryAnnuity: {
            piPerTurn: annuity.piPerTurn,
            turnsRemaining: annuity.turnsRemaining - 1,
          },
          updatedAt: new Date(),
        },
      }
    );
    processed++;
  }
  return processed;
}

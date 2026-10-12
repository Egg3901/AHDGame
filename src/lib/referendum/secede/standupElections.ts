/** Independence opens immediate elections for all new regional mandates, retaining the caretaker FM. */
import { ObjectId, type Db } from "mongodb";
import type { Election, State, Seat, GameState } from "@/lib/db/types";
import { buildStandupElections } from "./rules/standupElections";
import type { SecedingCountryId } from "./subRegions";

export async function standupElections(
  db: Db,
  countryId: SecedingCountryId,
  currentTurn: number,
  now: Date
): Promise<void> {
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { startingYear: 1, preset: 1 } });
  const regions = await db.collection<State>("states").find({ countryId }).toArray();
  const { rows, councils } = buildStandupElections({
    countryId,
    regions,
    currentTurn,
    now,
    startingYear: gameState?.startingYear ?? 2019,
    preset: gameState?.preset,
    id: () => new ObjectId().toHexString(),
  });
  await db
    .collection<Election>("elections")
    .insertMany(rows.map((row) => ({ ...row, _id: new ObjectId(row._id) })));
  await db.collection<State>("states").bulkWrite(
    regions.map((region) => ({
      updateOne: {
        filter: { _id: region._id },
        update: { $set: { stateSenateSeats: councils[region._id] } },
      },
    }))
  );
  await db.collection<Seat>("seats").bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: { _id: row.seatId! },
        update: {
          $set: {
            countryId,
            electionType: row.electionType.replace("snap_", ""),
            state: row.state,
            totalSeats: row.totalSeats,
            displayName: `${row.state} ${row.electionType.replace("snap_", "")}`,
            shortName: row.state,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    }))
  );
}

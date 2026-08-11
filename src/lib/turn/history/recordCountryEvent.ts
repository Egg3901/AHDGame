import type { Db, ObjectId } from "mongodb";
import { getCountryHistoryCollection } from "@/lib/db/collections/countryHistory";
import { getGameState } from "@/lib/gameState";
import type {
  CountryHistoryEvent,
  CountryHistoryEventType,
} from "@/lib/db/types/countryHistoryEvent";
import type { CountryId } from "@/lib/constants/countries";

export interface RecordCountryEventInput {
  countryId: CountryId;
  turn: number;
  eventType: CountryHistoryEventType;
  title: string;
  officeType?: string;
  characterId?: ObjectId;
  characterName?: string;
  party?: string;
  billId?: ObjectId;
  billScope?: string;
  details?: Record<string, unknown>;
}

/**
 * Append a country-history event. Non-critical: callers should not block the
 * turn pipeline on failure — wrap invocations with `.catch(...)` at the call
 * site and log, mirroring the existing fire-and-forget idiom used by news
 * post hooks.
 */
export async function recordCountryEvent(
  db: Db,
  input: RecordCountryEventInput,
  now: Date = new Date()
): Promise<void> {
  const col = await getCountryHistoryCollection(db);
  // Stamp the event with the iteration it was recorded in so generated wiki
  // office pages can group tenure by iteration and render correct Week/Year.
  const gameState = await getGameState(db);
  const iteration = gameState?.iteration;
  const iterationStartingYear = gameState?.startingYear;
  const doc: Omit<CountryHistoryEvent, "_id"> = {
    countryId: input.countryId,
    turn: input.turn,
    timestamp: now,
    eventType: input.eventType,
    title: input.title,
    officeType: input.officeType,
    characterId: input.characterId,
    characterName: input.characterName,
    party: input.party,
    billId: input.billId,
    billScope: input.billScope,
    details: input.details,
    ...(iteration ? { iteration } : {}),
    ...(iterationStartingYear != null ? { iterationStartingYear } : {}),
  };
  await col.insertOne(doc as CountryHistoryEvent);
}

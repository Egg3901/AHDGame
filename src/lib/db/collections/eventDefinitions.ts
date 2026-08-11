import type { Db } from "mongodb";
import type { EventDefinition } from "@/lib/db/types/events";

export function getEventDefinitionsCollection(db: Db) {
  return db.collection<EventDefinition>("eventDefinitions");
}

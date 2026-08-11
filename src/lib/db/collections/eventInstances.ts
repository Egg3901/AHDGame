import type { Db } from "mongodb";
import type { EventInstance } from "@/lib/db/types/events";

export function getEventInstancesCollection(db: Db) {
  return db.collection<EventInstance>("eventInstances");
}

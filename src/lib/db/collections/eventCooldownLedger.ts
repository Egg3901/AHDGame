import type { Db } from "mongodb";
import type { EventCooldownLedger } from "@/lib/db/types/events";

export function getEventCooldownLedgerCollection(db: Db) {
  return db.collection<EventCooldownLedger>("eventCooldownLedger");
}

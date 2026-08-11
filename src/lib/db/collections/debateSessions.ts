import type { Db } from "mongodb";
import type { DebateSession } from "@/lib/db/types/debateSession";

export function getDebateSessionsCollection(db: Db) {
  return db.collection<DebateSession>("debateSessions");
}

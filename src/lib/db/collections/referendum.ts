import type { Db } from "mongodb";
import type { Referendum } from "@/lib/db/types/referendum";

/** Typed `referendums` collection — independence/reunification referendums. */
export function getReferendumCollection(db: Db) {
  return db.collection<Referendum>("referendums");
}

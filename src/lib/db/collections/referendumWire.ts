import type { Db } from "mongodb";
import type { ReferendumWireEvent } from "@/lib/db/types/referendumWire";

/** Typed `referendumWire` collection — per-referendum campaign-wire events. */
export function getReferendumWireCollection(db: Db) {
  return db.collection<ReferendumWireEvent>("referendumWire");
}

import type { Db } from "mongodb";
import type { Ticket } from "../types/ticket";

export function getTicketsCollection(db: Db) {
  return db.collection<Ticket>("tickets");
}

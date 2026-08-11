import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { AlignmentPlay } from "../types/alignmentPlay";

/** Influence plays awaiting resolution by the alignment turn phase. */
export async function getAlignmentPlaysCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<AlignmentPlay>("alignmentPlays");
}

import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { AlignmentCrisis } from "../types/alignmentCrisis";

/** Flashpoints blocs bid over. Open ones hold their bids until the window closes. */
export async function getAlignmentCrisesCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<AlignmentCrisis>("alignmentCrises");
}

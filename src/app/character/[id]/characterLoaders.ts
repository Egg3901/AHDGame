import { ObjectId } from "mongodb";
import { cache } from "react";
import { getDb } from "@/lib/mongodb";
import type { Character } from "@/lib/db/types";
import { parseCharacterId } from "@/lib/utils/profileUrls";

export const truncate = (s: string | undefined | null, max = 200) =>
  !s ? "" : s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;

// Shared across the page metadata and the page body so Next.js renders
// the page with a single DB round-trip per request (React request cache).
export const loadCharacterByUrlId = cache(async (urlId: string): Promise<Character | null> => {
  const parsed = parseCharacterId(urlId);
  if (!parsed) return null;
  const db = await getDb();
  if (parsed.type === "sequential") {
    return db.collection<Character>("characters").findOne({ sequentialId: parsed.value });
  }
  if (!ObjectId.isValid(parsed.value)) return null;
  return db.collection<Character>("characters").findOne({ _id: new ObjectId(parsed.value) });
});

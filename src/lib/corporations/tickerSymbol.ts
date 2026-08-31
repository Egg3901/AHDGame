import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { isDuplicateKeyError } from "@/lib/api/errors";

/**
 * Insert a corporation, regenerating the ticker on a duplicate-key collision.
 *
 * `generateTickerSymbol` is check-then-insert: two concurrent creations (NPP
 * spawns in one turn, simultaneous spin-offs) can both see a candidate as free
 * and race the corporations_tickerSymbol_unique index. The loser lands here
 * with E11000; regenerating (which re-reads the DB, so it now sees the
 * winner's ticker) and retrying converges. Non-ticker duplicate keys rethrow.
 */
export async function insertCorporationWithTickerRetry(
  db: Db,
  corpDoc: Corporation,
  maxRetries = 3
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await db.collection<Corporation>("corporations").insertOne(corpDoc);
      return;
    } catch (err) {
      const isTickerCollision =
        isDuplicateKeyError(err) && err instanceof Error && err.message.includes("tickerSymbol");
      if (!isTickerCollision || attempt >= maxRetries) throw err;
      corpDoc.tickerSymbol = await generateTickerSymbol(db, corpDoc.name);
    }
  }
}

/**
 * Generate a unique ticker symbol for a corporation.
 * Derives initials from the name, checks uniqueness against the DB,
 * and appends a number if needed.
 */
export async function generateTickerSymbol(
  db: Db,
  name: string,
  maxAttempts = 20
): Promise<string> {
  const base = deriveTickerFromName(name);

  for (let i = 0; i < maxAttempts; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 4)}${i}`;
    const exists = await db.collection("corporations").findOne({ tickerSymbol: candidate });
    if (!exists) return candidate;
  }

  // Fallback: random 4-letter + digit
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let i = 0; i < maxAttempts; i++) {
    let candidate = "";
    for (let j = 0; j < 4; j++) {
      candidate += letters[Math.floor(Math.random() * letters.length)];
    }
    candidate += Math.floor(Math.random() * 10);
    const exists = await db.collection("corporations").findOne({ tickerSymbol: candidate });
    if (!exists) return candidate;
  }

  throw new Error(`Unable to generate unique ticker symbol after ${maxAttempts} attempts`);
}

function deriveTickerFromName(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean);

  if (words.length === 0) return "CORP";
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words
    .map((w) => w[0])
    .join("")
    .slice(0, 5)
    .toUpperCase();
}

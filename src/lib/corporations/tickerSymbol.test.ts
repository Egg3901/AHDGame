/**
 * GlitchTip AHD: E11000 on corporations_tickerSymbol_unique. Two concurrent
 * corp creations can race generateTickerSymbol's check-then-insert; the loser
 * must regenerate and retry instead of surfacing a raw MongoServerError.
 */
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { insertCorporationWithTickerRetry } from "./tickerSymbol";

function makeDuplicateKeyError(message: string): Error & { code: number } {
  const err = new Error(message) as Error & { code: number };
  err.code = 11000;
  return err;
}

function makeDb(insertOne: ReturnType<typeof vi.fn>, findOne?: ReturnType<typeof vi.fn>) {
  return {
    collection: () => ({
      insertOne,
      findOne: findOne ?? vi.fn().mockResolvedValue(null),
    }),
  } as unknown as Db;
}

function makeCorpDoc(): Corporation {
  return { name: "Acme Steel", tickerSymbol: "AS" } as Corporation;
}

describe("insertCorporationWithTickerRetry", () => {
  it("inserts once when there is no collision", async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: "x" });
    await insertCorporationWithTickerRetry(makeDb(insertOne), makeCorpDoc());
    expect(insertOne).toHaveBeenCalledTimes(1);
  });

  it("regenerates the ticker and retries on a ticker duplicate key", async () => {
    const insertOne = vi
      .fn()
      .mockRejectedValueOnce(
        makeDuplicateKeyError(
          "E11000 duplicate key error collection: a-house-divided.corporations index: corporations_tickerSymbol_unique dup key"
        )
      )
      .mockResolvedValue({ insertedId: "x" });
    const corpDoc = makeCorpDoc();
    await insertCorporationWithTickerRetry(makeDb(insertOne), corpDoc);
    expect(insertOne).toHaveBeenCalledTimes(2);
    // Regenerated from the name via generateTickerSymbol, replacing the loser.
    expect(corpDoc.tickerSymbol).toBe("AS");
  });

  it("rethrows duplicate keys on other indexes untouched", async () => {
    const insertOne = vi
      .fn()
      .mockRejectedValue(
        makeDuplicateKeyError("E11000 duplicate key error index: some_other_index")
      );
    await expect(
      insertCorporationWithTickerRetry(makeDb(insertOne), makeCorpDoc())
    ).rejects.toMatchObject({ code: 11000 });
    expect(insertOne).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry budget and rethrows", async () => {
    const insertOne = vi
      .fn()
      .mockRejectedValue(makeDuplicateKeyError("E11000 ... corporations_tickerSymbol_unique ..."));
    await expect(
      insertCorporationWithTickerRetry(makeDb(insertOne), makeCorpDoc(), 2)
    ).rejects.toMatchObject({ code: 11000 });
    expect(insertOne).toHaveBeenCalledTimes(3);
  });
});

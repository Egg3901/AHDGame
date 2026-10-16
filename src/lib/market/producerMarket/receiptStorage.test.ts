import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { decodeReceipt, encodeReceipt, stageReceiptChunks } from "./receiptStorage";

describe("chunked producer receipts", () => {
  it("round-trips a complete receipt beyond a Mongo document without changing any rows", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    const original = {
      version: 1,
      trades: Array.from({ length: 20000 }, (_, i) => ({
        id: `trade:${i}`,
        units: i,
        note: "x".repeat(1024),
      })),
      accounts: [{ id: "a", cash: 1 }],
    };
    const encoded = encodeReceipt(original);
    expect(encoded.chunks.length).toBeGreaterThan(20);
    expect(Buffer.byteLength(encoded.payload)).toBeLessThan(1024 * 1024);
    for (const chunk of encoded.chunks)
      expect(Buffer.byteLength(chunk.payload)).toBeLessThan(12 * 1024 * 1024);
    await stageReceiptChunks(db, encoded.chunks);
    await stageReceiptChunks(db, encoded.chunks);
    expect(memory.collection("producerEconomyTurnChunks").docs).toHaveLength(encoded.chunks.length);
    expect(await decodeReceipt(db, encoded)).toEqual(original);
  });

  it("fails closed for missing or corrupted chunks", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    const encoded = encodeReceipt({
      trades: Array.from({ length: 129 }, (_, i) => ({ units: i })),
    });
    await expect(decodeReceipt(db, encoded)).rejects.toThrow("Missing");
    await stageReceiptChunks(db, encoded.chunks);
    memory.collection("producerEconomyTurnChunks").docs[0].payload = encodeReceipt([1]).payload;
    await expect(decodeReceipt(db, encoded)).rejects.toThrow("checksum");
    await expect(stageReceiptChunks(db, encoded.chunks)).rejects.toThrow("checksum");
  });

  it("rejects a single oversized row before staging any receipt", () => {
    expect(() => encodeReceipt(Array.from({ length: 129 }, () => "x".repeat(1024 * 1024)))).toThrow(
      "row exceeds"
    );
  });
});

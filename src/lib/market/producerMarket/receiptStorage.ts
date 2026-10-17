/** Immutable content-addressed chunks keep full turn receipts below Mongo's document limit. */
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { Db } from "mongodb";

interface ReceiptChunk {
  _id: string;
  payload: string;
}
export interface EncodedReceipt {
  payload: string;
  digest: string;
  chunks: ReceiptChunk[];
}
const ARRAY_CHUNK_BYTES = 1024 * 1024;
const DOCUMENT_LIMIT = 12 * 1024 * 1024;
const ROOT_DECODE_LIMIT = 16 * 1024 * 1024;
const CHUNK_DECODE_LIMIT = 2 * ARRAY_CHUNK_BYTES;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const encode = (json: string) => gzipSync(json).toString("base64");
const decode = (payload: string, limit: number) =>
  gunzipSync(Buffer.from(payload, "base64"), { maxOutputLength: limit });

export function encodeReceipt(value: unknown): EncodedReceipt {
  const chunks = new Map<string, ReceiptChunk>();
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item) && item.length > 128) {
      const ids: string[] = [];
      let rows: string[] = [],
        bytes = 2;
      const flush = () => {
        if (!rows.length) return;
        const json = `[${rows.join(",")}]`;
        const id = hash(json);
        chunks.set(id, { _id: id, payload: encode(json) });
        ids.push(id);
        rows = [];
        bytes = 2;
      };
      for (const row of item) {
        const json = JSON.stringify(row);
        if (json === undefined) throw new Error("Unserializable producer receipt row");
        const size = Buffer.byteLength(json) + 1;
        if (size + 2 > ARRAY_CHUNK_BYTES)
          throw new Error("Producer receipt row exceeds chunk limit");
        if (bytes + size > ARRAY_CHUNK_BYTES) flush();
        rows.push(json);
        bytes += size;
      }
      flush();
      return { $producerReceiptArray: ids, count: item.length };
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object" && "$producerReceiptArray" in item)
      throw new Error("Reserved producer receipt field");
    if (item && typeof item === "object")
      return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, visit(entry)]));
    return item;
  };
  const json = JSON.stringify(visit(value));
  if (Buffer.byteLength(json) > ROOT_DECODE_LIMIT)
    throw new Error("Producer receipt manifest exceeds limit");
  const payload = encode(json);
  if (Buffer.byteLength(payload) > DOCUMENT_LIMIT)
    throw new Error("Producer receipt document exceeds limit");
  return { payload, digest: hash(json), chunks: [...chunks.values()] };
}

/** All chunks land before the caller atomically claims the complete manifest. */
export async function stageReceiptChunks(db: Db, chunks: readonly ReceiptChunk[]): Promise<void> {
  if (!chunks.length) return;
  // Content hash is the primary key. Mongo's built-in unique _id index is sufficient.
  await db.collection<ReceiptChunk>("producerEconomyTurnChunks").bulkWrite(
    chunks.map((chunk) => ({
      updateOne: { filter: { _id: chunk._id }, update: { $setOnInsert: chunk }, upsert: true },
    }))
  );
  const stored = await db
    .collection<ReceiptChunk>("producerEconomyTurnChunks")
    .find({ _id: { $in: chunks.map((chunk) => chunk._id) } })
    .toArray();
  if (stored.length !== chunks.length) throw new Error("Missing staged producer receipt chunk");
  for (const chunk of stored) {
    if (hash(decode(chunk.payload, CHUNK_DECODE_LIMIT)) !== chunk._id)
      throw new Error("Staged producer receipt chunk checksum mismatch");
  }
}

export async function decodeReceipt(
  db: Db,
  record: Pick<EncodedReceipt, "payload" | "digest">
): Promise<unknown> {
  const bytes = decode(record.payload, ROOT_DECODE_LIMIT);
  if (hash(bytes) !== record.digest) throw new Error("Producer receipt checksum mismatch");
  const root: unknown = JSON.parse(bytes.toString("utf8"));
  const required = new Set<string>();
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (!value || typeof value !== "object") return;
    if ("$producerReceiptArray" in value) {
      const ids = value.$producerReceiptArray;
      if (
        !Array.isArray(ids) ||
        ids.some((id) => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
      )
        throw new Error("Invalid producer receipt chunk reference");
      ids.forEach((id: string) => required.add(id));
    } else Object.values(value).forEach(collect);
  };
  collect(root);
  const stored = required.size
    ? await db
        .collection<ReceiptChunk>("producerEconomyTurnChunks")
        .find({ _id: { $in: [...required] } })
        .toArray()
    : [];
  const chunks = new Map(stored.map((chunk) => [chunk._id, chunk]));
  const restore = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(restore);
    if (!value || typeof value !== "object") return value;
    if ("$producerReceiptArray" in value) {
      const marker = value as { $producerReceiptArray: string[]; count: number };
      const result: unknown[] = [];
      for (const id of marker.$producerReceiptArray) {
        const chunk = chunks.get(id);
        if (!chunk) throw new Error("Missing producer receipt chunk");
        const decoded = decode(chunk.payload, CHUNK_DECODE_LIMIT);
        if (hash(decoded) !== id) throw new Error("Producer receipt chunk checksum mismatch");
        const rows: unknown = JSON.parse(decoded.toString("utf8"));
        if (!Array.isArray(rows)) throw new Error("Invalid producer receipt array chunk");
        for (const row of rows) result.push(row);
      }
      if (result.length !== marker.count) throw new Error("Producer receipt row count mismatch");
      return result;
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, restore(entry)]));
  };
  return restore(root);
}

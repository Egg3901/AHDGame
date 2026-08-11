/**
 * Stream a set of Mongo documents to Cloudflare R2 as gzipped NDJSON, in
 * bounded batches so we never hold a whole collection in memory (this codebase
 * has already been bitten by DB memory pressure — keep the archiver frugal).
 *
 * Each batch of up to BATCH_SIZE docs becomes one gzipped part object:
 *   retention/{dbName}/{collection}/turn-lt-{cutoff}-{stamp}-part-{n}.ndjson.gz
 * so a large archive is many small objects rather than one giant buffer.
 */
import { gzipSync } from "zlib";
import type { Db, Document } from "mongodb";
import { EJSON } from "bson";
import { uploadFile } from "@/lib/r2";

const BATCH_SIZE = 5000;

export interface ArchiveResult {
  archivedCount: number;
  parts: number;
  bytes: number;
  keys: string[];
}

/**
 * Archive every document matching `filter` from `collection` to R2. Uploads
 * are verified by awaiting each PutObject (throws on failure), so the caller
 * can safely delete only after this resolves.
 */
export async function archiveDocs(params: {
  db: Db;
  dbName: string;
  collection: string;
  filter: Document;
  cutoff: number;
  stamp: string;
}): Promise<ArchiveResult> {
  const { db, dbName, collection, filter, cutoff, stamp } = params;
  const prefix = `retention/${dbName}/${collection}/turn-lt-${cutoff}-${stamp}`;

  const cursor = db.collection(collection).find(filter).batchSize(BATCH_SIZE);
  let batch: string[] = [];
  let part = 0;
  let archivedCount = 0;
  let bytes = 0;
  const keys: string[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const gz = gzipSync(Buffer.from(batch.join("\n") + "\n", "utf8"));
    const key = `${prefix}-part-${String(part).padStart(4, "0")}.ndjson.gz`;
    // uploadFile awaits the PutObject (throws on failure), so a resolved call
    // means the part is safely in R2 before we ever delete the source rows.
    await uploadFile(key, gz, "application/gzip");
    keys.push(key);
    bytes += gz.length;
    part += 1;
    batch = [];
  };

  for await (const doc of cursor) {
    // Canonical Extended JSON preserves BSON types exactly (ObjectId, Date,
    // Decimal128, Long) so archived financial rows are losslessly recoverable.
    batch.push(EJSON.stringify(doc, { relaxed: false }));
    archivedCount += 1;
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  return { archivedCount, parts: part, bytes, keys };
}

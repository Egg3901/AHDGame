import { randomUUID } from "node:crypto";
import { calculateObjectSize } from "bson";
import type { Db, Document } from "mongodb";

export const SIM_EXPERIMENT_REPORTS = "simExperimentReports";
export const SIM_EXPERIMENT_REPORT_CHUNKS = "simExperimentReportChunks";

const CHUNK_TARGET_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;

export const EXPERIMENT_TIMELINE_FIELDS = [
  "seatsTimeline",
  "partyOrgTimeline",
  "corporationsTimeline",
] as const;

type TimelineField = (typeof EXPERIMENT_TIMELINE_FIELDS)[number];

interface ChunkStorageManifest {
  version: 1;
  generation: string;
  chunkCount: number;
}

export interface StoredExperimentReport extends Document {
  _id: string;
  timelineStorage?: ChunkStorageManifest;
  seatsTimeline?: unknown[];
  partyOrgTimeline?: unknown[];
  corporationsTimeline?: unknown[];
}

export interface TimelineChunk extends Document {
  runId: string;
  generation: string;
  field: TimelineField;
  sequence: number;
  points: unknown[];
}

function assertDocumentFits(document: Record<string, unknown>, label: string): void {
  const bytes = calculateObjectSize(document);
  if (bytes > MAX_DOCUMENT_BYTES) {
    throw new Error(`${label} is ${bytes} bytes, above MongoDB's 16 MiB document limit`);
  }
}

/** Split unbounded timelines before the MongoDB driver attempts BSON serialization. */
export function planTimelineChunks(
  runId: string,
  generation: string,
  report: Record<string, unknown>,
  targetBytes = CHUNK_TARGET_BYTES
): TimelineChunk[] {
  const chunks: TimelineChunk[] = [];

  for (const field of EXPERIMENT_TIMELINE_FIELDS) {
    const points = report[field];
    if (!Array.isArray(points) || points.length === 0) continue;

    let sequence = 0;
    let chunk: TimelineChunk = { runId, generation, field, sequence, points: [] };
    let estimatedBytes = calculateObjectSize(chunk);
    for (const point of points) {
      // BSON array indexes add a small key per point. Sixty-four bytes is a
      // conservative allowance and avoids repeatedly serializing a growing
      // chunk, which would make long reports quadratic to plan.
      const pointBytes = calculateObjectSize({ point }) + 64;
      if (chunk.points.length > 0 && estimatedBytes + pointBytes > targetBytes) {
        assertDocumentFits(chunk, `${field} chunk ${sequence}`);
        chunks.push(chunk);
        sequence += 1;
        chunk = { runId, generation, field, sequence, points: [point] };
        estimatedBytes = calculateObjectSize(chunk);
      } else {
        chunk.points.push(point);
        estimatedBytes += pointBytes;
      }
    }
    assertDocumentFits(chunk, `${field} chunk ${sequence}`);
    chunks.push(chunk);
  }

  return chunks;
}

export async function writeExperimentReport(
  db: Db,
  runId: string,
  report: Record<string, unknown>
): Promise<void> {
  const generation = randomUUID();
  const chunks = planTimelineChunks(runId, generation, report);
  const metadata = Object.fromEntries(
    Object.entries(report).filter(
      ([key]) => !EXPERIMENT_TIMELINE_FIELDS.includes(key as TimelineField)
    )
  );
  const stored = {
    runId,
    ...metadata,
    timelineStorage: { version: 1 as const, generation, chunkCount: chunks.length },
    collectedAt: new Date(),
  };
  assertDocumentFits(stored, "experiment report metadata");

  const reports = db.collection<StoredExperimentReport>(SIM_EXPERIMENT_REPORTS);
  const chunkCollection = db.collection<TimelineChunk>(SIM_EXPERIMENT_REPORT_CHUNKS);
  await chunkCollection.createIndex(
    { runId: 1, generation: 1, field: 1, sequence: 1 },
    { name: "experiment_report_generation" }
  );
  try {
    if (chunks.length > 0) await chunkCollection.insertMany(chunks);
    await reports.updateOne(
      { _id: runId },
      {
        $set: stored,
        $unset: Object.fromEntries(EXPERIMENT_TIMELINE_FIELDS.map((field) => [field, ""])),
      },
      { upsert: true }
    );
  } catch (error) {
    await chunkCollection.deleteMany({ runId, generation });
    throw error;
  }
  // The manifest now points at the new generation. Old chunks are harmless if
  // this cleanup fails, so do not roll back or delete the active generation.
  try {
    await chunkCollection.deleteMany({ runId, generation: { $ne: generation } });
  } catch (error) {
    console.warn(`Experiment report ${runId} retained stale timeline chunks`, error);
  }
}

/** Read both legacy inline reports and chunked long-horizon reports. */
export async function readExperimentReport(
  db: Db,
  runId: string
): Promise<StoredExperimentReport | null> {
  const report = await db
    .collection<StoredExperimentReport>(SIM_EXPERIMENT_REPORTS)
    .findOne({ _id: runId });
  if (!report?.timelineStorage) return report;

  const chunks = await db
    .collection<TimelineChunk>(SIM_EXPERIMENT_REPORT_CHUNKS)
    .find({ runId, generation: report.timelineStorage.generation })
    .sort({ field: 1, sequence: 1 })
    .toArray();
  return hydrateExperimentReport(report, chunks);
}

export function hydrateExperimentReport(
  report: StoredExperimentReport,
  chunks: TimelineChunk[]
): StoredExperimentReport {
  if (!report.timelineStorage) return report;
  if (chunks.length !== report.timelineStorage.chunkCount) {
    throw new Error(
      `Experiment report ${report._id} expected ${report.timelineStorage.chunkCount} timeline chunks, found ${chunks.length}`
    );
  }

  for (const field of EXPERIMENT_TIMELINE_FIELDS) report[field] = [];
  for (const chunk of chunks) {
    for (const point of chunk.points) report[chunk.field]?.push(point);
  }
  return report;
}

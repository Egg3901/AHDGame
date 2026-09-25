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
  "longHorizonTelemetry.approval.points",
  "longHorizonTelemetry.macro.points",
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
  longHorizonTelemetry?: {
    approval?: { points?: unknown[]; [key: string]: unknown };
    macro?: { points?: unknown[]; [key: string]: unknown };
    [key: string]: unknown;
  };
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

function timelinePoints(report: Record<string, unknown>, field: TimelineField): unknown {
  if (!field.startsWith("longHorizonTelemetry.")) return report[field];
  const telemetry = report.longHorizonTelemetry as Record<string, unknown> | undefined;
  const section = telemetry?.[field.split(".")[1]] as Record<string, unknown> | undefined;
  return section?.points;
}

function reportMetadata(report: Record<string, unknown>): Record<string, unknown> {
  const metadata = Object.fromEntries(
    Object.entries(report).filter(
      ([key]) => !EXPERIMENT_TIMELINE_FIELDS.includes(key as TimelineField)
    )
  );
  const telemetry = metadata.longHorizonTelemetry as Record<string, unknown> | undefined;
  if (telemetry) {
    metadata.longHorizonTelemetry = {
      ...telemetry,
      approval: telemetry.approval
        ? { ...(telemetry.approval as Record<string, unknown>), points: [] }
        : undefined,
      macro: telemetry.macro
        ? { ...(telemetry.macro as Record<string, unknown>), points: [] }
        : undefined,
    };
  }
  return metadata;
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
    const points = timelinePoints(report, field);
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
  const metadata = reportMetadata(report);
  const stored = {
    _id: runId,
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
    await reports.replaceOne({ _id: runId }, stored, { upsert: true });
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

  const chunkedFields = new Set(chunks.map((chunk) => chunk.field));
  for (const field of EXPERIMENT_TIMELINE_FIELDS) {
    if (field.startsWith("longHorizonTelemetry.")) {
      const section = field.split(".")[1] as "approval" | "macro";
      if (chunkedFields.has(field) && report.longHorizonTelemetry?.[section]) {
        report.longHorizonTelemetry[section].points = [];
      }
    } else {
      report[field] = [];
    }
  }
  for (const chunk of chunks) {
    if (chunk.field.startsWith("longHorizonTelemetry.")) {
      const section = chunk.field.split(".")[1] as "approval" | "macro";
      report.longHorizonTelemetry?.[section]?.points?.push(...chunk.points);
    } else {
      for (const point of chunk.points) (report[chunk.field] as unknown[])?.push(point);
    }
  }
  return report;
}

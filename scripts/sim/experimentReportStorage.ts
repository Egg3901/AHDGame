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

export const EXPERIMENT_CHUNK_FIELDS = [
  ...EXPERIMENT_TIMELINE_FIELDS,
  "longHorizonTelemetry.approval.points",
  "longHorizonTelemetry.approval.series",
  "longHorizonTelemetry.macro.points",
  "longHorizonTelemetry.macro.series",
] as const;

type TimelineField = (typeof EXPERIMENT_CHUNK_FIELDS)[number];

interface ChunkStorageManifest {
  version: 1 | 2;
  generation: string;
  chunkCount: number;
  fields?: { path: TimelineField; pointCount: number; chunkCount: number }[];
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

function valueAtPath(report: Record<string, unknown>, path: string): unknown {
  let current: unknown = report;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Copy only the object spine so planning never mutates the caller's report. */
function setArrayAtPath(report: Record<string, unknown>, path: string, points: unknown[]): void {
  const parts = path.split(".");
  let current = report;
  for (const part of parts.slice(0, -1)) {
    const prior = current[part];
    const next = prior && typeof prior === "object" && !Array.isArray(prior) ? { ...prior } : {};
    current[part] = next;
    current = next;
  }
  current[parts[parts.length - 1]] = points;
}

/** Split unbounded timelines before the MongoDB driver attempts BSON serialization. */
export function planTimelineChunks(
  runId: string,
  generation: string,
  report: Record<string, unknown>,
  targetBytes = CHUNK_TARGET_BYTES
): TimelineChunk[] {
  const chunks: TimelineChunk[] = [];

  for (const field of EXPERIMENT_CHUNK_FIELDS) {
    const points = valueAtPath(report, field);
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
  const metadata = { ...report };
  const fields: NonNullable<ChunkStorageManifest["fields"]> = [];
  for (const path of EXPERIMENT_CHUNK_FIELDS) {
    const points = valueAtPath(report, path);
    if (!Array.isArray(points)) continue;
    fields.push({
      path,
      pointCount: points.length,
      chunkCount: chunks.filter((c) => c.field === path).length,
    });
    if (path.includes(".")) setArrayAtPath(metadata, path, []);
    else delete metadata[path];
  }
  const stored = {
    runId,
    ...metadata,
    timelineStorage: { version: 2 as const, generation, chunkCount: chunks.length, fields },
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

/** Read the MCP's sampled timelines without transferring unrelated telemetry. */
export async function readExperimentReportSummary(
  db: Db,
  runId: string,
  maxPoints: number
): Promise<StoredExperimentReport | null> {
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 10 || maxPoints > 5000)
    throw new Error("Report sample limit must be an integer between 10 and 5000");
  const inlineSample = (field: string) => ({
    $let: {
      vars: { points: { $cond: [{ $isArray: `$${field}` }, `$${field}`, []] } },
      in: {
        $cond: [
          { $lte: [{ $size: "$$points" }, maxPoints] },
          "$$points",
          {
            $map: {
              input: { $range: [0, maxPoints] },
              as: "index",
              in: {
                $arrayElemAt: [
                  "$$points",
                  {
                    $floor: {
                      $multiply: ["$$index", { $divide: [{ $size: "$$points" }, maxPoints] }],
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    },
  });
  const [report] = await db
    .collection<StoredExperimentReport>(SIM_EXPERIMENT_REPORTS)
    .aggregate<StoredExperimentReport>([
      { $match: { _id: runId } },
      {
        $project: {
          _id: 1,
          turn: 1,
          finalMetrics: 1,
          collectedAt: 1,
          timelineStorage: 1,
          ...Object.fromEntries(
            EXPERIMENT_TIMELINE_FIELDS.map((field) => [field, inlineSample(field)])
          ),
        },
      },
    ])
    .toArray();
  if (!report?.timelineStorage) return report ?? null;
  const manifest = report.timelineStorage;
  if (manifest.version !== 1 && manifest.version !== 2)
    throw new Error("Unsupported report storage version");
  if (manifest.version === 2 && !manifest.fields) throw new Error("Missing report field manifest");
  const descriptors = await db
    .collection<TimelineChunk>(SIM_EXPERIMENT_REPORT_CHUNKS)
    .aggregate<{ field: TimelineField; sequence: number; pointCount: number }>([
      { $match: { runId, generation: manifest.generation } },
      { $project: { _id: 0, field: 1, sequence: 1, pointCount: { $size: "$points" } } },
      { $sort: { field: 1, sequence: 1 } },
    ])
    .toArray();
  if (descriptors.length !== manifest.chunkCount)
    throw new Error(
      `Experiment report ${runId} expected ${manifest.chunkCount} timeline chunks, found ${descriptors.length}`
    );
  const fields =
    manifest.version === 2
      ? manifest.fields!.map((entry) => entry.path)
      : [...new Set([...EXPERIMENT_TIMELINE_FIELDS, ...descriptors.map((chunk) => chunk.field)])];
  if (new Set(fields).size !== fields.length) throw new Error("Duplicate report field manifest");
  if (
    fields.some((field) => !EXPERIMENT_CHUNK_FIELDS.includes(field)) ||
    descriptors.some((chunk) => !fields.includes(chunk.field))
  )
    throw new Error("Unexpected report chunk field");
  const plans: { field: TimelineField; sequence: number; indexes: number[] }[] = [];
  for (const field of fields) {
    const selected = descriptors.filter((chunk) => chunk.field === field);
    if (
      selected.some(
        (chunk, index) =>
          chunk.sequence !== index ||
          !Number.isSafeInteger(chunk.pointCount) ||
          chunk.pointCount < 0
      )
    )
      throw new Error(`Non-contiguous report chunks: ${field}`);
    const count = selected.reduce((total, chunk) => total + chunk.pointCount, 0);
    const expected = manifest.fields?.find((entry) => entry.path === field);
    if (
      !Number.isSafeInteger(count) ||
      (manifest.version === 2 &&
        (selected.length !== expected?.chunkCount || count !== expected?.pointCount))
    )
      throw new Error(`Incomplete report field: ${field}`);
    if (!(EXPERIMENT_TIMELINE_FIELDS as readonly string[]).includes(field)) continue;
    const indexes = Array.from({ length: Math.min(count, maxPoints) }, (_, index) =>
      count <= maxPoints ? index : Math.floor(index * (count / maxPoints))
    );
    let offset = 0;
    for (const chunk of selected) {
      const local = indexes
        .filter((index) => index >= offset && index < offset + chunk.pointCount)
        .map((index) => index - offset);
      if (local.length) plans.push({ field, sequence: chunk.sequence, indexes: local });
      offset += chunk.pointCount;
    }
    report[field] = [];
  }
  if (!plans.length) return report;
  const samples = await db
    .collection<TimelineChunk>(SIM_EXPERIMENT_REPORT_CHUNKS)
    .aggregate<Pick<TimelineChunk, "field" | "sequence" | "points">>([
      {
        $match: {
          runId,
          generation: manifest.generation,
          $or: plans.map(({ field, sequence }) => ({ field, sequence })),
        },
      },
      {
        $project: {
          _id: 0,
          field: 1,
          sequence: 1,
          points: {
            $switch: {
              branches: plans.map((plan) => ({
                case: {
                  $and: [{ $eq: ["$field", plan.field] }, { $eq: ["$sequence", plan.sequence] }],
                },
                then: {
                  $map: {
                    input: plan.indexes,
                    as: "index",
                    in: { $arrayElemAt: ["$points", "$$index"] },
                  },
                },
              })),
              default: [],
            },
          },
        },
      },
      { $sort: { field: 1, sequence: 1 } },
    ])
    .toArray();
  if (samples.length !== plans.length) throw new Error("Report generation changed during sampling");
  for (const sample of samples) {
    const plan = plans.find(
      (item) => item.field === sample.field && item.sequence === sample.sequence
    );
    if (!plan || sample.points.length !== plan.indexes.length)
      throw new Error("Incomplete report sample");
    report[sample.field]!.push(...sample.points);
  }
  return report;
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

  const manifest = report.timelineStorage;
  if (manifest.version !== 1 && manifest.version !== 2)
    throw new Error("Unsupported report storage version");
  if (manifest.version === 2 && !manifest.fields) throw new Error("Missing report field manifest");
  const fields: TimelineField[] =
    manifest.version === 2
      ? manifest.fields!.map((entry) => entry.path)
      : [
          ...new Set<TimelineField>([
            ...EXPERIMENT_TIMELINE_FIELDS,
            ...chunks.map((chunk) => chunk.field),
          ]),
        ];
  if (new Set(fields).size !== fields.length) throw new Error("Duplicate report field manifest");
  for (const chunk of chunks) {
    if (
      chunk.runId !== report._id ||
      chunk.generation !== manifest.generation ||
      !fields.includes(chunk.field)
    ) {
      throw new Error("Unexpected report chunk identity or field");
    }
  }
  for (const field of fields) {
    if (!EXPERIMENT_CHUNK_FIELDS.includes(field)) throw new Error("Unknown report chunk path");
    const selected = chunks
      .filter((chunk) => chunk.field === field)
      .sort((a, b) => a.sequence - b.sequence);
    if (selected.some((chunk, index) => chunk.sequence !== index))
      throw new Error(`Non-contiguous report chunks: ${field}`);
    const points = selected.flatMap((chunk) => chunk.points);
    const expected = manifest.fields?.find((entry) => entry.path === field);
    if (
      manifest.version === 2 &&
      (selected.length !== expected?.chunkCount || points.length !== expected?.pointCount)
    ) {
      throw new Error(`Incomplete report field: ${field}`);
    }
    setArrayAtPath(report, field, points);
  }
  return report;
}

import { calculateObjectSize } from "bson";
import { describe, expect, it } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  hydrateExperimentReport,
  planTimelineChunks,
  writeExperimentReport,
} from "./experimentReportStorage";

describe("experiment report timeline storage (#2287)", () => {
  it("splits a timeline above the failing 17.8 MB payload size into safe BSON documents", () => {
    const payload = "x".repeat(18_000);
    const report = {
      seatsTimeline: Array.from({ length: 1_000 }, (_, turn) => ({ turn, payload })),
      partyOrgTimeline: [],
      corporationsTimeline: [],
    };

    expect(calculateObjectSize(report)).toBeGreaterThan(17_825_798);
    const chunks = planTimelineChunks("run-240", "generation-1", report);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((chunk) => chunk.points)).toEqual(report.seatsTimeline);
    expect(Math.max(...chunks.map((chunk) => calculateObjectSize(chunk)))).toBeLessThanOrEqual(
      8 * 1024 * 1024
    );
  });

  it("keeps each timeline independently ordered", () => {
    const report = {
      seatsTimeline: [{ turn: 1 }, { turn: 2 }],
      partyOrgTimeline: [{ turn: 3 }],
      corporationsTimeline: [{ turn: 4 }],
    };
    const chunks = planTimelineChunks("run", "generation", report, 100);

    for (const field of Object.keys(report) as Array<keyof typeof report>) {
      expect(
        chunks.filter((chunk) => chunk.field === field).flatMap((chunk) => chunk.points)
      ).toEqual(report[field]);
    }
  });

  it("reassembles chunked timelines and rejects an incomplete generation", () => {
    const source = {
      seatsTimeline: [{ turn: 1 }, { turn: 2 }],
      partyOrgTimeline: [{ turn: 3 }],
      corporationsTimeline: [{ turn: 4 }],
    };
    const chunks = planTimelineChunks("run", "generation", source, 100);
    const stored = {
      _id: "run",
      timelineStorage: { version: 1 as const, generation: "generation", chunkCount: chunks.length },
    };

    expect(hydrateExperimentReport({ ...stored }, chunks)).toMatchObject(source);
    expect(() => hydrateExperimentReport({ ...stored }, chunks.slice(1))).toThrow(
      "expected 4 timeline chunks, found 3"
    );
  });

  it("hydrates version 1 nested telemetry chunks and preserves older inline points", () => {
    const nested = {
      seatsTimeline: [],
      partyOrgTimeline: [],
      corporationsTimeline: [],
      longHorizonTelemetry: {
        approval: { points: [{ turn: 1 }] },
        macro: { points: [{ turn: 2 }] },
      },
    };
    const chunks = planTimelineChunks("run", "generation", nested, 100);
    const stored = {
      _id: "run",
      longHorizonTelemetry: { approval: { points: [] }, macro: { points: [] } },
      timelineStorage: { version: 1 as const, generation: "generation", chunkCount: chunks.length },
    };
    expect(hydrateExperimentReport(stored, chunks).longHorizonTelemetry).toEqual(
      nested.longHorizonTelemetry
    );
    const inline = {
      _id: "run",
      longHorizonTelemetry: { approval: { points: [{ turn: 3 }] } },
      timelineStorage: { version: 1 as const, generation: "generation", chunkCount: 0 },
    };
    expect(hydrateExperimentReport(inline, []).longHorizonTelemetry?.approval?.points).toEqual([
      { turn: 3 },
    ]);
  });
  it("round-trips nested telemetry above 26 MB without oversized Mongo documents", async () => {
    const db = createMockDb();
    const source = {
      seatsTimeline: [{ turn: 1 }],
      partyOrgTimeline: [],
      corporationsTimeline: [],
      longHorizonTelemetry: {
        schemaVersion: 1,
        availability: "observed-complete",
        approval: {
          points: Array.from({ length: 500 }, (_, turn) => ({ turn, payload: "a".repeat(18000) })),
          series: [{ country: "UK", missingTurns: [] }],
        },
        macro: {
          points: Array.from({ length: 1000 }, (_, turn) => ({ turn, payload: "m".repeat(18000) })),
          series: [],
        },
      },
    };
    expect(calculateObjectSize(source)).toBeGreaterThan(26_000_000);
    const originalFirst = source.longHorizonTelemetry.approval.points[0];
    await writeExperimentReport(db as never, "nested", source);
    const chunks = db.collection("simExperimentReportChunks").insertMany.mock.calls[0][0];
    const stored = {
      _id: "nested",
      ...db.collection("simExperimentReports").updateOne.mock.calls[0][1].$set,
    };
    expect(calculateObjectSize(stored)).toBeLessThan(16 * 1024 * 1024);
    expect(
      chunks.every(
        (chunk: Record<string, unknown>) => calculateObjectSize(chunk) < 16 * 1024 * 1024
      )
    ).toBe(true);
    expect(hydrateExperimentReport(stored, chunks)).toMatchObject(source);
    expect(source.longHorizonTelemetry.approval.points).toHaveLength(500);
    expect(source.longHorizonTelemetry.approval.points[0]).toBe(originalFirst);
  });

  it("refuses duplicate chunk sequence even when the total count matches", () => {
    const chunks = planTimelineChunks(
      "run",
      "generation",
      { seatsTimeline: [{ turn: 1 }, { turn: 2 }] },
      100
    );
    const stored = {
      _id: "run",
      timelineStorage: { version: 1 as const, generation: "generation", chunkCount: 2 },
    };
    expect(() => hydrateExperimentReport(stored, [chunks[0], chunks[0]])).toThrow("Non-contiguous");
    expect(() =>
      hydrateExperimentReport(
        stored,
        chunks.map((chunk) => ({ ...chunk, generation: "other" }))
      )
    ).toThrow("identity");
  });
});

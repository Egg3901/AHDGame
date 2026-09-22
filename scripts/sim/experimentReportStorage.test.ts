import { calculateObjectSize } from "bson";
import { describe, expect, it } from "vitest";
import { hydrateExperimentReport, planTimelineChunks } from "./experimentReportStorage";

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
});

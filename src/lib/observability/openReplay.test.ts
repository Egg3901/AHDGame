import { describe, expect, it } from "vitest";
import {
  normalizeOpenReplayIngestUrl,
  parseOpenReplaySampleRate,
  shouldRecordOpenReplay,
} from "./openReplay";

describe("OpenReplay configuration", () => {
  it("normalizes the ingest endpoint", () => {
    expect(normalizeOpenReplayIngestUrl("https://replay.example/")).toBe(
      "https://replay.example/ingest"
    );
    expect(normalizeOpenReplayIngestUrl("https://replay.example/ingest")).toBe(
      "https://replay.example/ingest"
    );
  });

  it("defaults to disabled and clamps configured sample rates", () => {
    expect(parseOpenReplaySampleRate(undefined)).toBe(0);
    expect(parseOpenReplaySampleRate("invalid")).toBe(0);
    expect(parseOpenReplaySampleRate("-1")).toBe(0);
    expect(parseOpenReplaySampleRate("0.25")).toBe(0.25);
    expect(parseOpenReplaySampleRate("2")).toBe(1);
  });

  it("records only consented sessions selected by sampling", () => {
    expect(shouldRecordOpenReplay(null, 1, 0)).toBe(false);
    expect(shouldRecordOpenReplay("rejected", 1, 0)).toBe(false);
    expect(shouldRecordOpenReplay("accepted", 0.25, 0.1)).toBe(true);
    expect(shouldRecordOpenReplay("accepted", 0.25, 0.3)).toBe(false);
  });
});

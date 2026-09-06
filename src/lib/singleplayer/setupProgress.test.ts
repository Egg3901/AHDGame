import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  noteSingleplayerSetupWork,
  readSingleplayerSetupProgress,
  setSingleplayerSetupProgress,
} from "./setupProgress";

describe("singleplayer setup progress", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setSingleplayerSetupProgress({
      active: false,
      phase: "idle",
      label: "Ready",
      detail: "",
      progress: 0,
    });
  });

  it("advances within the active phase without claiming completion", () => {
    setSingleplayerSetupProgress({ active: true, phase: "building", progress: 20 });
    noteSingleplayerSetupWork("Seeded parties");
    expect(readSingleplayerSetupProgress()).toMatchObject({
      active: true,
      phase: "building",
      detail: "Seeded parties",
      progress: 20.65,
      stalled: false,
    });
  });

  it("marks a live step stalled after thirty seconds without discarding it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    setSingleplayerSetupProgress({ active: true, phase: "building", progress: 40 });
    vi.advanceTimersByTime(30_001);
    expect(readSingleplayerSetupProgress()).toMatchObject({ active: true, stalled: true });
  });
});

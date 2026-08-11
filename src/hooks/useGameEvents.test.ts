import { describe, it, expect } from "vitest";
import { detectTurnEvents } from "./useGameEvents";

const FUTURE = new Date(Date.now() + 3_600_000).toISOString();

describe("detectTurnEvents", () => {
  it("emits nothing on first poll when prevTurn is null", () => {
    const status = {
      currentTurn: 100,
      isActive: true,
      isProcessing: false,
      nextScheduledTurn: FUTURE,
    };
    expect(detectTurnEvents(null, status)).toEqual([]);
  });

  it("emits turn_complete when currentTurn has increased", () => {
    const status = {
      currentTurn: 101,
      isActive: true,
      isProcessing: false,
      nextScheduledTurn: FUTURE,
    };
    expect(detectTurnEvents(100, status)).toEqual(["turn_complete"]);
  });

  it("emits nothing when currentTurn is unchanged and not processing", () => {
    const status = {
      currentTurn: 100,
      isActive: true,
      isProcessing: false,
      nextScheduledTurn: FUTURE,
    };
    expect(detectTurnEvents(100, status)).toEqual([]);
  });

  it("emits nothing when game is paused", () => {
    const status = {
      currentTurn: 101,
      isActive: false,
      isProcessing: false,
      nextScheduledTurn: null,
    };
    expect(detectTurnEvents(100, status)).toEqual([]);
  });

  it("emits turn_start when isProcessing flag is set and turn hasn't changed", () => {
    const status = {
      currentTurn: 100,
      isActive: true,
      isProcessing: true,
      nextScheduledTurn: FUTURE,
    };
    expect(detectTurnEvents(100, status)).toEqual(["turn_start"]);
  });

  it("emits nothing on first poll even when isProcessing is set", () => {
    const status = {
      currentTurn: 100,
      isActive: true,
      isProcessing: true,
      nextScheduledTurn: FUTURE,
    };
    expect(detectTurnEvents(null, status)).toEqual([]);
  });

  it("emits turn_complete (not turn_start) when turn incremented even if isProcessing still set", () => {
    const status = {
      currentTurn: 101,
      isActive: true,
      isProcessing: true,
      nextScheduledTurn: FUTURE,
    };
    expect(detectTurnEvents(100, status)).toEqual(["turn_complete"]);
  });
});

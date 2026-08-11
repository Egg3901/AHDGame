import { describe, it, expect } from "vitest";
import { validateSSEEvent } from "./events";

describe("validateSSEEvent", () => {
  it("returns true for a valid GameEvent", () => {
    const event = {
      type: "turn_complete",
      payload: { turn: 1 },
      timestamp: "2026-04-03T00:00:00.000Z",
    };
    expect(validateSSEEvent(event)).toBe(true);
  });

  it("returns true for theme_changed event", () => {
    const event = {
      type: "theme_changed",
      payload: { theme: "dark", userId: "abc123" },
      timestamp: "2026-04-03T00:00:00.000Z",
      userId: "abc123",
    };
    expect(validateSSEEvent(event)).toBe(true);
  });

  it("returns false for null", () => {
    expect(validateSSEEvent(null)).toBe(false);
  });

  it("returns false when type is missing", () => {
    expect(validateSSEEvent({ payload: {}, timestamp: "2026-04-03T00:00:00.000Z" })).toBe(false);
  });

  it("returns false when payload is missing", () => {
    expect(validateSSEEvent({ type: "turn_complete", timestamp: "2026-04-03T00:00:00.000Z" })).toBe(
      false
    );
  });

  it("returns false when timestamp is missing", () => {
    expect(validateSSEEvent({ type: "turn_complete", payload: {} })).toBe(false);
  });

  it("returns false when type is not a string", () => {
    expect(validateSSEEvent({ type: 42, payload: {}, timestamp: "2026-04-03T00:00:00.000Z" })).toBe(
      false
    );
  });
});

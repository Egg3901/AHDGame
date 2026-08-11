import { describe, it, expect } from "vitest";
import {
  isUserActive,
  INACTIVE_PLAYER_TURN_THRESHOLD,
  INACTIVE_SHAREHOLDER_TURN_THRESHOLD,
  INACTIVE_SHAREHOLDER_WARN_TURN_THRESHOLD,
} from "./playerActivity";

const TURN_MS = 60 * 60 * 1000;
const NOW = new Date("2026-06-23T00:00:00.000Z");
const ago = (turns: number) => new Date(NOW.getTime() - turns * TURN_MS);

describe("isUserActive", () => {
  it("threshold is 96 turns", () => {
    expect(INACTIVE_PLAYER_TURN_THRESHOLD).toBe(96);
  });

  it("active exactly at the 96-turn boundary", () => {
    expect(isUserActive(ago(96), undefined, NOW)).toBe(true);
  });

  it("inactive strictly beyond 96 turns", () => {
    expect(isUserActive(ago(97), undefined, NOW)).toBe(false);
  });

  it("falls back to createdAt when lastActivity is missing", () => {
    expect(isUserActive(undefined, ago(10), NOW)).toBe(true);
    expect(isUserActive(undefined, ago(200), NOW)).toBe(false);
  });

  it("prefers lastActivity over createdAt when both present", () => {
    // Recent activity overrides an old account; stale activity overrides a new one.
    expect(isUserActive(ago(2), ago(500), NOW)).toBe(true);
    expect(isUserActive(ago(500), ago(2), NOW)).toBe(false);
  });

  it("treats a player with neither date as active", () => {
    expect(isUserActive(undefined, undefined, NOW)).toBe(true);
    expect(isUserActive(null, null, NOW)).toBe(true);
  });
});

describe("isUserActive with custom threshold", () => {
  it("exposes the 168-turn shareholder threshold", () => {
    expect(INACTIVE_SHAREHOLDER_TURN_THRESHOLD).toBe(168);
  });

  it("exposes the 144-turn share-release warning threshold", () => {
    expect(INACTIVE_SHAREHOLDER_WARN_TURN_THRESHOLD).toBe(144);
  });

  it("active exactly at the custom threshold boundary", () => {
    expect(isUserActive(ago(168), undefined, NOW, INACTIVE_SHAREHOLDER_TURN_THRESHOLD)).toBe(true);
  });

  it("inactive strictly beyond the custom threshold", () => {
    expect(isUserActive(ago(169), undefined, NOW, INACTIVE_SHAREHOLDER_TURN_THRESHOLD)).toBe(false);
  });

  it("still treats missing dates as active under a custom threshold", () => {
    expect(isUserActive(undefined, undefined, NOW, INACTIVE_SHAREHOLDER_TURN_THRESHOLD)).toBe(true);
  });

  it("default threshold remains 96 turns when omitted", () => {
    expect(isUserActive(ago(97), undefined, NOW)).toBe(false);
    expect(isUserActive(ago(96), undefined, NOW)).toBe(true);
  });
});

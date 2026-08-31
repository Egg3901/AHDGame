import { describe, it, expect } from "vitest";
import { canReshuffle, recordReshuffle, type ReshuffleRecord } from "./reshuffleLimit";

const at = new Date("2026-01-01");

describe("canReshuffle", () => {
  it("allows a reshuffle when none recorded this parliament", () => {
    expect(canReshuffle([], "gov1", "p1").allowed).toBe(true);
  });
  it("blocks a second reshuffle in the same parliament", () => {
    const log: ReshuffleRecord[] = [{ governmentId: "gov1", parliamentId: "p1", at }];
    expect(canReshuffle(log, "gov1", "p1").allowed).toBe(false);
  });
  it("allows again in a new parliament (after dissolution)", () => {
    const log: ReshuffleRecord[] = [{ governmentId: "gov1", parliamentId: "p1", at }];
    expect(canReshuffle(log, "gov1", "p2").allowed).toBe(true);
  });
  it("allows a new government in the same parliament", () => {
    const log: ReshuffleRecord[] = [{ governmentId: "gov1", parliamentId: "p1", at }];
    expect(canReshuffle(log, "gov2", "p1").allowed).toBe(true);
  });
});

describe("recordReshuffle", () => {
  it("appends when permitted", () => {
    const { log, recorded } = recordReshuffle([], "gov1", "p1", at);
    expect(recorded).toBe(true);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ governmentId: "gov1", parliamentId: "p1" });
  });
  it("is a no-op when already used this parliament", () => {
    const existing: ReshuffleRecord[] = [{ governmentId: "gov1", parliamentId: "p1", at }];
    const { log, recorded } = recordReshuffle(existing, "gov1", "p1", new Date("2026-02-01"));
    expect(recorded).toBe(false);
    expect(log).toBe(existing); // unchanged reference
  });
  it("does not mutate the input log when appending", () => {
    const input: ReshuffleRecord[] = [];
    const { log } = recordReshuffle(input, "gov1", "p1", at);
    expect(input).toHaveLength(0);
    expect(log).toHaveLength(1);
  });
});

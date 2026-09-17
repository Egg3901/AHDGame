import { describe, expect, it } from "vitest";
import { canClaimAt, claimFilterAt, parseClaimWindow } from "./claimWindow";

describe("worldsim claim window", () => {
  const window = parseClaimWindow("03:00-08:00", "America/New_York");

  it("admits jobs from 3am through 7:59am Eastern", () => {
    expect(canClaimAt(new Date("2026-01-15T08:00:00Z"), window)).toBe(true);
    expect(canClaimAt(new Date("2026-01-15T12:59:00Z"), window)).toBe(true);
    expect(canClaimAt(new Date("2026-01-15T13:00:00Z"), window)).toBe(false);
  });

  it("follows daylight saving time", () => {
    expect(canClaimAt(new Date("2026-07-15T07:00:00Z"), window)).toBe(true);
    expect(canClaimAt(new Date("2026-07-15T12:00:00Z"), window)).toBe(false);
  });

  it("leaves claiming unrestricted when no window is configured", () => {
    expect(canClaimAt(new Date(), null)).toBe(true);
  });

  it("admits immediate jobs outside the unattended window", () => {
    expect(claimFilterAt(new Date("2026-07-15T12:00:00Z"), window)).toEqual({
      status: "queued",
      startPolicy: "immediate",
    });
  });

  it("admits all queued jobs inside the unattended window", () => {
    expect(claimFilterAt(new Date("2026-07-15T07:00:00Z"), window)).toEqual({
      status: "queued",
    });
  });
});

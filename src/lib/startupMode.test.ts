import { describe, expect, it } from "vitest";
import { shouldStartHostedBackgroundServices } from "./startupMode";

describe("startup mode", () => {
  it("does not run hosted seed, migration or cron work in singleplayer", () => {
    expect(shouldStartHostedBackgroundServices({ SINGLEPLAYER: "1" })).toBe(false);
  });

  it("keeps hosted background services enabled in production", () => {
    expect(shouldStartHostedBackgroundServices({})).toBe(true);
  });
});

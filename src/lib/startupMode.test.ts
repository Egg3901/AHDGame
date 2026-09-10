import { describe, expect, it } from "vitest";
import {
  shouldStartHostedBackgroundServices,
  shouldRunCronInWebProcess,
  isCronWorkerProcess,
} from "./startupMode";

describe("startup mode", () => {
  it("does not run hosted seed, migration or cron work in singleplayer", () => {
    expect(shouldStartHostedBackgroundServices({ SINGLEPLAYER: "1" })).toBe(false);
  });

  it("keeps hosted background services enabled in production", () => {
    expect(shouldStartHostedBackgroundServices({})).toBe(true);
  });
});

describe("cron ownership", () => {
  it("keeps web running cron when nothing is configured", () => {
    // THE DEFAULT, and the one that matters most. Until the worker service exists,
    // every environment must behave exactly as it does today.
    expect(shouldRunCronInWebProcess({})).toBe(true);
    expect(isCronWorkerProcess({})).toBe(false);
  });

  it("hands cron to the worker when one is declared", () => {
    expect(shouldRunCronInWebProcess({ CRON_OWNER: "worker" })).toBe(false);
    expect(isCronWorkerProcess({ CRON_OWNER: "worker" })).toBe(true);
  });

  it("fails safe on a typo: web keeps the schedule", () => {
    // A misconfigured worker must never leave a world with nobody running turns.
    // Anything that is not exactly "worker" leaves web in charge.
    for (const value of ["Worker", "WORKER", "true", "1", "", "wroker"]) {
      expect(shouldRunCronInWebProcess({ CRON_OWNER: value }), value).toBe(true);
      expect(isCronWorkerProcess({ CRON_OWNER: value }), value).toBe(false);
    }
  });

  it("still respects the local and singleplayer opt-outs", () => {
    expect(shouldRunCronInWebProcess({ DISABLE_DEV_BACKGROUND: "1" })).toBe(false);
    expect(shouldRunCronInWebProcess({ SINGLEPLAYER: "1" })).toBe(false);
  });
});

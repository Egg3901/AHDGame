import { describe, expect, it } from "vitest";
import {
  blockedSettingChange,
  cooldownTurnsRemaining,
  requestedSettingCooldownFields,
  stampsForSettingChange,
} from "./settingCooldowns";

describe("settingCooldowns", () => {
  it("treats a missing stamp as not on cooldown", () => {
    expect(cooldownTurnsRemaining(undefined, 100)).toBe(0);
  });

  it("returns remaining turns inside the 24-turn window", () => {
    expect(cooldownTurnsRemaining(90, 100)).toBe(14);
  });

  it("returns zero once the window has elapsed", () => {
    expect(cooldownTurnsRemaining(76, 100)).toBe(0);
  });

  it("collects only the fields present on the request body", () => {
    expect(requestedSettingCooldownFields({ tierSetting: "balanced" })).toEqual(["tierSetting"]);
    expect(
      requestedSettingCooldownFields({
        targetRegionId: "CA",
        targetCountryId: "UK",
        aidPriority: "humanitarian",
      })
    ).toEqual(["targetRegionId", "targetCountryId", "aidPriority"]);
  });

  it("does not let a recent tier change block a regional target", () => {
    expect(
      blockedSettingChange(
        { lastChangedTurn: 90, tierSetting: "balanced" },
        ["targetRegionId"],
        100
      )
    ).toBeNull();
  });

  it("still blocks the same lever inside its own window", () => {
    expect(
      blockedSettingChange({ lastChangedTurn: 90, tierSetting: "balanced" }, ["tierSetting"], 100)
    ).toEqual({ field: "tierSetting", turnsRemaining: 14 });
    expect(blockedSettingChange({ lastRegionChangedTurn: 95 }, ["targetRegionId"], 100)).toEqual({
      field: "targetRegionId",
      turnsRemaining: 19,
    });
  });

  it("keeps foreign envoy and aid priority on independent clocks", () => {
    expect(
      blockedSettingChange({ lastTargetCountryChangedTurn: 90 }, ["aidPriority"], 100)
    ).toBeNull();
    expect(
      blockedSettingChange({ lastAidPriorityChangedTurn: 90 }, ["targetCountryId"], 100)
    ).toBeNull();
  });

  it("unblocks tier when lastChangedTurn is a legacy allocation-only stamp", () => {
    expect(
      blockedSettingChange(
        { lastChangedTurn: 100, allocationPercents: { CA: 100 } },
        ["tierSetting"],
        100
      )
    ).toBeNull();
  });

  it("stamps only the levers that actually changed", () => {
    expect(stampsForSettingChange(["targetRegionId"], 100)).toEqual({
      lastRegionChangedTurn: 100,
    });
    expect(stampsForSettingChange(["tierSetting", "aidPriority"], 42)).toEqual({
      lastChangedTurn: 42,
      lastAidPriorityChangedTurn: 42,
    });
  });
});

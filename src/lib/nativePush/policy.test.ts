import { describe, expect, it } from "vitest";
import { shouldPush, PUSH_PREVIEW } from "./policy";

const now = new Date("2026-01-01T12:00:00Z");
const notification = { type: "general_win" as const, read: false };
describe("native inbox push policy", () => {
  it("delivers unread election and corporation activity", () => {
    expect(shouldPush(notification, {}, now)).toBe(true);
    expect(shouldPush({ type: "corp_vote_opened", read: false }, {}, now)).toBe(true);
  });
  it("respects mutes, active snoozes and per-message read/archive state", () => {
    expect(shouldPush(notification, { mutedTypes: ["general_win"] }, now)).toBe(false);
    expect(
      shouldPush(
        notification,
        { snoozedTypes: [{ type: "general_win", until: new Date(now.getTime() + 1) }] },
        now
      )
    ).toBe(false);
    expect(shouldPush({ ...notification, read: true }, {}, now)).toBe(false);
    expect(shouldPush({ ...notification, archivedAt: now }, {}, now)).toBe(false);
    expect(
      shouldPush({ ...notification, snoozedUntil: new Date(now.getTime() + 1) }, {}, now)
    ).toBe(false);
  });
  it("expires snoozes and keeps routine income out of push", () => {
    expect(
      shouldPush(notification, { snoozedTypes: [{ type: "general_win", until: now }] }, now)
    ).toBe(true);
    expect(shouldPush({ type: "resource_income", read: false }, {}, now)).toBe(false);
  });
  it("uses a fixed private preview and inbox destination", () => {
    expect(PUSH_PREVIEW).toEqual({
      title: "A House Divided",
      body: "You have new activity. Open your inbox to catch up.",
      path: "/notifications",
    });
  });
});

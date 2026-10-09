import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { buildPushPreview, safePushHref, shouldPush, PUSH_PREVIEW } from "./policy";

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
});

const alert = (overrides: Record<string, unknown> = {}) => ({
  _id: new ObjectId("0123456789abcdef01234567"),
  type: "general_win" as const,
  title: "You won the Ohio Senate race",
  message: "You carried 54.2% of the vote.",
  metadata: { electionId: "aaaaaaaaaaaaaaaaaaaaaaaa" },
  ...overrides,
});

describe("native push preview", () => {
  it("shows the newest alert's own text, category and page", () => {
    expect(buildPushPreview([alert()])).toEqual({
      title: "You won the Ohio Senate race",
      subtitle: "Election",
      body: "You carried 54.2% of the vote.",
      path: "/notifications",
      href: "/elections/aaaaaaaaaaaaaaaaaaaaaaaa",
      thread: "election",
      count: 1,
      id: "0123456789abcdef01234567",
    });
  });
  it("counts the alerts behind the newest one", () => {
    const older = alert({ _id: new ObjectId(), type: "bill_vote_open", title: "Vote open" });
    const newest = alert({ type: "crisis", title: "Crisis", metadata: { crisisId: "c1" } });
    const preview = buildPushPreview([older, older, newest]);
    expect(preview).toMatchObject({
      title: "Crisis",
      subtitle: "Crisis · 2 more in your inbox",
      href: "/world/crises/c1",
      thread: "crisis",
      count: 3,
    });
  });
  it("keeps the inbox route for 2.3.x apps and falls back to it without a page", () => {
    const preview = buildPushPreview([alert({ type: "system", metadata: undefined })]);
    expect(preview?.path).toBe("/notifications");
    expect(preview?.href).toBe("/notifications");
    expect(buildPushPreview([])).toBeNull();
  });
  it("flattens and bounds text, and fills empty fields", () => {
    const preview = buildPushPreview([
      alert({ title: "  ", message: `Line one\n\tline two ${"x".repeat(500)}` }),
    ]);
    expect(preview?.title).toBe("Election result");
    expect(preview?.body.startsWith("Line one line two x")).toBe(true);
    expect(preview?.body.length).toBe(360);
    expect(preview?.body.endsWith("…")).toBe(true);
    expect(buildPushPreview([alert({ message: "" })])?.body).toBe(PUSH_PREVIEW.body);
  });
  it("never sends a destination off this site", () => {
    expect(safePushHref("/congress/bills/1")).toBe("/congress/bills/1");
    expect(safePushHref("https://ask.lakesidegames.net/x")).toBe("/notifications");
    expect(safePushHref("//example.com/x")).toBe("/notifications");
    expect(safePushHref("/\\example.com")).toBe("/notifications");
    expect(safePushHref("/a b")).toBe("/notifications");
    expect(safePushHref(undefined)).toBe("/notifications");
  });
});

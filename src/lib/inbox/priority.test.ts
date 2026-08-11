import { describe, it, expect } from "vitest";
import { isActionRequired, isActionRequiredType } from "./priority";

describe("isActionRequired", () => {
  it("flags unread mail as action", () => {
    expect(isActionRequired({ kind: "mail", unread: true })).toBe(true);
    expect(isActionRequired({ kind: "mail", unread: false })).toBe(false);
  });
  it("flags unread action-type notifications", () => {
    expect(isActionRequired({ kind: "notif", unread: true, type: "bill_vote_open" })).toBe(true);
    expect(isActionRequired({ kind: "notif", unread: true, type: "crisis" })).toBe(true);
    expect(isActionRequired({ kind: "notif", unread: true, type: "election_opened" })).toBe(true);
  });
  it("does not flag non-action or read notifications", () => {
    expect(isActionRequired({ kind: "notif", unread: true, type: "bill_passed_chamber" })).toBe(
      false
    );
    expect(isActionRequired({ kind: "notif", unread: false, type: "bill_vote_open" })).toBe(false);
  });
  it("isActionRequiredType is metadata-free", () => {
    expect(isActionRequiredType("coalition_invite_received")).toBe(true);
    expect(isActionRequiredType("wire_received")).toBe(false);
  });
});

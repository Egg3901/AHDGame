// src/lib/inbox/mailThreads.test.ts
import { describe, it, expect } from "vitest";
import { groupMailIntoThreads } from "./mailThreads";

const mail = (over: Partial<any>) => ({
  _id: "x",
  fromCharacterId: "them",
  fromCharacterName: "Karen Marsh",
  toCharacterId: "me",
  toCharacterName: "You",
  subject: "floor strategy",
  body: "b",
  read: false,
  createdAt: "2026-06-20T10:00:00.000Z",
  ...over,
});

describe("groupMailIntoThreads", () => {
  it("groups inbox+sent by counterpart + normalized subject, chronologically", () => {
    const inbox = [
      mail({ _id: "i1", subject: "Re: floor strategy", createdAt: "2026-06-20T12:00:00.000Z" }),
    ];
    const sent = [
      mail({
        _id: "s1",
        fromCharacterId: "me",
        toCharacterId: "them",
        subject: "floor strategy",
        createdAt: "2026-06-20T10:00:00.000Z",
      }),
    ];
    const threads = groupMailIntoThreads(inbox, sent, "me");
    expect(threads).toHaveLength(1);
    expect(threads[0].messages.map((m) => m.from)).toEqual(["you", "them"]);
    expect(threads[0].subject).toBe("floor strategy");
    expect(threads[0].unread).toBe(true);
  });
  it("keeps distinct counterparts in separate threads", () => {
    const inbox = [
      mail({ _id: "a", fromCharacterId: "p1" }),
      mail({ _id: "b", fromCharacterId: "p2" }),
    ];
    expect(groupMailIntoThreads(inbox, [], "me")).toHaveLength(2);
  });
});

// src/lib/inbox/inboxItem.test.ts
import { describe, it, expect } from "vitest";
import { notificationToInboxItem, mailThreadToInboxItem } from "./inboxItem";

const NOW = Date.parse("2026-06-20T12:10:00.000Z");

describe("notificationToInboxItem", () => {
  it("maps category, action flag, source, relative time, and display context", () => {
    const item = notificationToInboxItem(
      {
        _id: "n1",
        type: "bill_vote_open",
        title: "S-2203 on the floor",
        message: "Vote closes at resolve.",
        read: false,
        metadata: { billId: "b1", chamber: "Senate", turn: 42 },
        createdAt: "2026-06-20T12:04:00.000Z",
      },
      NOW
    );
    expect(item.kind).toBe("notif");
    expect(item.category).toBe("legislation");
    expect(item.action).toBe(true);
    expect(item.source?.href).toBe("/congress/bills/b1");
    expect(item.time).toBe("6m");
    expect(item.label).toBe("Vote open");
    expect(item.urgency).toBe("decision");
    expect(item.createdAt).toBe("2026-06-20T12:04:00.000Z");
    expect(item.meta).toEqual([
      ["Chamber", "Senate"],
      ["Turn", "42"],
    ]);
  });
});

describe("mailThreadToInboxItem", () => {
  it("maps a thread to a mail inbox item", () => {
    const item = mailThreadToInboxItem(
      {
        id: "t1",
        counterpartName: "Karen Marsh",
        subject: "floor strategy",
        unread: true,
        latestAt: "2026-06-20T12:00:00.000Z",
        messages: [{ from: "them", time: "2026-06-20T12:00:00.000Z", body: "hi" }],
      },
      NOW
    );
    expect(item.kind).toBe("mail");
    expect(item.action).toBe(true);
    expect(item.title).toBe("floor strategy");
    expect(item.label).toBe("Direct mail");
    expect(item.urgency).toBe("decision");
    expect(item.createdAt).toBe("2026-06-20T12:00:00.000Z");
  });
});

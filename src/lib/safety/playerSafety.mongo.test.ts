import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  REAL_MONGO_ENABLED,
  startIsolatedMongod,
  stopIsolatedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";

vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn(async () => undefined) }));

import {
  blockPlayer,
  listBlockedPlayers,
  MAX_BLOCKED_USERS,
  PLAYER_CONTENT_REPORTS,
  reportPlayer,
  unblockPlayer,
} from "./playerSafety";
import { sendPlayerMail } from "@/lib/mail/commands/playerMail";
import { getInboxMailPage } from "@/lib/mail/queries/playerMail";

describe.runIf(REAL_MONGO_ENABLED)("player reports and blocks against isolated mongod", () => {
  let fixture: IsolatedMongod | null = null;
  let db: Db;
  const alice = { user: new ObjectId(), char: new ObjectId() };
  const bully = { user: new ObjectId(), char: new ObjectId() };

  beforeAll(async () => {
    fixture = await startIsolatedMongod("ahd-player-safety-");
    db = fixture.db;
  });
  afterAll(async () => {
    await stopIsolatedMongod(fixture);
    fixture = null;
  });
  beforeEach(async () => {
    await Promise.all(
      ["users", "characters", "playerMail", PLAYER_CONTENT_REPORTS].map((c) =>
        db.collection(c).deleteMany({})
      )
    );
    await db.collection("users").insertMany([
      { _id: alice.user, username: "alice", role: "player" },
      { _id: bully.user, username: "bully", role: "player" },
    ]);
    await db.collection("characters").insertMany([
      { _id: alice.char, userId: alice.user, name: "Alice", sequentialId: 1 },
      { _id: bully.char, userId: bully.user, name: "Bully", sequentialId: 2 },
    ]);
  });

  const bullySender = () => ({
    _id: bully.char,
    name: "Bully",
    sequentialId: 2,
    userId: bully.user,
  });

  it("hides existing mail, refuses new mail, and restores on unblock", async () => {
    await sendPlayerMail(db, bullySender(), alice.char.toHexString(), "hi", "first");
    expect((await getInboxMailPage(db, alice.user, 0, 10)).total).toBe(1);

    await blockPlayer(db, alice.user.toHexString(), bully.char.toHexString());
    expect((await getInboxMailPage(db, alice.user, 0, 10)).total).toBe(0);
    await expect(
      sendPlayerMail(db, bullySender(), alice.char.toHexString(), "again", "second")
    ).rejects.toThrow("Cannot send mail to this player");
    expect(await listBlockedPlayers(db, alice.user.toHexString())).toEqual([
      { userId: bully.user.toHexString(), characterName: "Bully" },
    ]);

    await unblockPlayer(db, alice.user.toHexString(), { userId: bully.user.toHexString() });
    expect((await getInboxMailPage(db, alice.user, 0, 10)).total).toBe(1);
    expect(await listBlockedPlayers(db, alice.user.toHexString())).toEqual([]);
  });

  it("is idempotent and refuses self-blocks and a full list", async () => {
    await blockPlayer(db, alice.user.toHexString(), bully.char.toHexString());
    await blockPlayer(db, alice.user.toHexString(), bully.char.toHexString());
    const doc = await db.collection("users").findOne({ _id: alice.user });
    expect(doc?.blockedUserIds).toHaveLength(1);
    await expect(
      blockPlayer(db, alice.user.toHexString(), alice.char.toHexString())
    ).rejects.toThrow("cannot block yourself");

    const full = Array.from({ length: MAX_BLOCKED_USERS }, () => new ObjectId());
    await db.collection("users").updateOne({ _id: alice.user }, { $set: { blockedUserIds: full } });
    await expect(
      blockPlayer(db, alice.user.toHexString(), bully.char.toHexString())
    ).rejects.toThrow(`up to ${MAX_BLOCKED_USERS}`);
  });

  it("keeps one open report per reporter and target", async () => {
    const input = {
      reason: "harassment" as const,
      context: "profile" as const,
      details: " rude bio ",
    };
    await reportPlayer(db, alice.user.toHexString(), bully.char.toHexString(), input);
    await expect(
      reportPlayer(db, alice.user.toHexString(), bully.char.toHexString(), input)
    ).rejects.toThrow("already reported");
    const reports = await db.collection(PLAYER_CONTENT_REPORTS).find().toArray();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      targetUserId: bully.user,
      targetCharacterName: "Bully",
      details: "rude bio",
      status: "pending",
    });

    await db.collection(PLAYER_CONTENT_REPORTS).updateMany({}, { $set: { status: "actioned" } });
    await reportPlayer(db, alice.user.toHexString(), bully.char.toHexString(), input);
    expect(await db.collection(PLAYER_CONTENT_REPORTS).countDocuments()).toBe(2);
    await expect(
      reportPlayer(db, alice.user.toHexString(), alice.char.toHexString(), input)
    ).rejects.toThrow("cannot report yourself");
  });
});

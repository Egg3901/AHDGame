import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { imposeEmbargo, liftEmbargo } from "./embargoCommands";
import {
  TRADE_EMBARGO_MAX_DURATION_TURNS,
  TRADE_EMBARGO_TARGET_COOLDOWN_TURNS,
} from "@/lib/trade/constants";

const actor = new ObjectId();
const baseInput = {
  sourceCountry: "US" as const,
  targetCountry: "CN" as const,
  commodity: "steel" as const,
  direction: "export" as const,
  mode: "block" as const,
  durationTurns: 24,
  currentTurn: 100,
  createdBy: actor,
};

describe("imposeEmbargo", () => {
  it("rejects self-embargo", async () => {
    const db = createMockDb();
    const r = await imposeEmbargo(db as unknown as Db, { ...baseInput, targetCountry: "US" });
    expect(r.ok).toBe(false);
  });

  it("rejects a cap embargo with no cap", async () => {
    const db = createMockDb();
    const r = await imposeEmbargo(db as unknown as Db, { ...baseInput, mode: "cap" });
    expect(r.ok).toBe(false);
  });

  it("rejects a duplicate active embargo", async () => {
    const db = createMockDb();
    const col = db.collection("tradeEmbargoes");
    (col.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ _id: new ObjectId() });
    const r = await imposeEmbargo(db as unknown as Db, baseInput);
    expect(r.ok).toBe(false);
  });

  it("rejects a duration longer than the cap", async () => {
    const db = createMockDb();
    const r = await imposeEmbargo(db as unknown as Db, {
      ...baseInput,
      durationTurns: TRADE_EMBARGO_MAX_DURATION_TURNS + 1,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects when the source→target pair is on cooldown (atomic gate dup-key)", async () => {
    const db = createMockDb();
    const cooldownCol = db.collection("embargoCooldowns");
    // The atomic acquire throws E11000 when an active lock already exists.
    (cooldownCol.findOneAndUpdate as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      code: 11000,
    });
    (cooldownCol.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sourceCountry: "US",
      targetCountry: "CN",
      cooldownUntilTurn: baseInput.currentTurn + 10,
      lastEnactedTurn: 0,
      characterId: actor,
    });
    const r = await imposeEmbargo(db as unknown as Db, baseInput);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cooldown/i);
    expect(cooldownCol.createIndex).toHaveBeenCalledWith(
      { sourceCountry: 1, targetCountry: 1 },
      { unique: true, name: "embargoCooldowns_pair_unique" }
    );
    // No embargo row was inserted when the gate rejects.
    expect(db.collectionMocks["tradeEmbargoes"]!.insertOne).not.toHaveBeenCalled();
  });

  it("rejects when the member already has the maximum active embargoes", async () => {
    const db = createMockDb();
    (
      db.collection("tradeEmbargoes").countDocuments as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(2);
    const r = await imposeEmbargo(db as unknown as Db, baseInput);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/active/i);
  });

  it("inserts a temporary embargo with expiry and arms the cooldown on success", async () => {
    const db = createMockDb();
    const r = await imposeEmbargo(db as unknown as Db, baseInput);
    expect(r.ok).toBe(true);
    const col = db.collectionMocks["tradeEmbargoes"]!;
    expect(col.insertOne).toHaveBeenCalledTimes(1);
    const doc = (col.insertOne as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(doc.origin).toBe("minister");
    expect(doc.expiresTurn).toBe(124); // 100 + 24

    const cooldownCol = db.collectionMocks["embargoCooldowns"]!;
    expect(cooldownCol.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, opts] = (cooldownCol.findOneAndUpdate as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(filter).toMatchObject({
      sourceCountry: "US",
      targetCountry: "CN",
      cooldownUntilTurn: { $lte: baseInput.currentTurn },
    });
    expect(update.$set.cooldownUntilTurn).toBe(
      baseInput.currentTurn + TRADE_EMBARGO_TARGET_COOLDOWN_TURNS
    );
    expect(opts).toMatchObject({ upsert: true });
  });
});

describe("liftEmbargo", () => {
  it("errors when the embargo is missing", async () => {
    const db = createMockDb();
    const r = await liftEmbargo(db as unknown as Db, new ObjectId(), "US");
    expect(r.ok).toBe(false);
  });

  it("rejects lifting another country's embargo", async () => {
    const db = createMockDb();
    const id = new ObjectId();
    (db.collection("tradeEmbargoes").findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      _id: id,
      sourceCountry: "CN",
      origin: "minister",
    });
    const r = await liftEmbargo(db as unknown as Db, id, "US");
    expect(r.ok).toBe(false);
  });

  it("rejects lifting a legislation embargo", async () => {
    const db = createMockDb();
    const id = new ObjectId();
    (db.collection("tradeEmbargoes").findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      _id: id,
      sourceCountry: "US",
      origin: "legislation",
    });
    const r = await liftEmbargo(db as unknown as Db, id, "US");
    expect(r.ok).toBe(false);
  });

  it("deletes a minister embargo on success", async () => {
    const db = createMockDb();
    const id = new ObjectId();
    (db.collection("tradeEmbargoes").findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      _id: id,
      sourceCountry: "US",
      origin: "minister",
    });
    const r = await liftEmbargo(db as unknown as Db, id, "US");
    expect(r.ok).toBe(true);
    expect(db.collectionMocks["tradeEmbargoes"]!.deleteOne).toHaveBeenCalledTimes(1);
  });
});

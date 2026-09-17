import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn(async () => undefined),
}));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn(async () => undefined) }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn(async () => ({ currentTurn: 42 })) }));

import { applyLegislationEffect } from "@/lib/legislationEffects";
import { onBillEnacted } from "@/lib/billEnactment";
import { enactSingleplayerDecree } from "./enactSingleplayerDecree";

describe("singleplayer head-of-state decrees", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atomically signs and applies a newly proposed law", async () => {
    const updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
    const db = { collection: vi.fn(() => ({ updateOne })) };
    const bill = {
      _id: new ObjectId(),
      countryId: "US",
      title: "Executive programme",
      status: "active",
    };

    await expect(enactSingleplayerDecree(db as never, bill as never)).resolves.toBe(true);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: bill._id, status: "active" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "signed" }) })
    );
    expect(applyLegislationEffect).toHaveBeenCalledOnce();
    expect(onBillEnacted).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ status: "signed" }),
      42
    );
  });

  it("does not apply effects when another worker already changed the bill", async () => {
    const db = {
      collection: vi.fn(() => ({ updateOne: vi.fn(async () => ({ modifiedCount: 0 })) })),
    };
    await expect(
      enactSingleplayerDecree(db as never, { _id: new ObjectId(), status: "active" } as never)
    ).resolves.toBe(false);
    expect(applyLegislationEffect).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  getSingleplayerHeadOfStateOfficeType,
  seatSingleplayerHeadOfState,
} from "./singleplayerHeadOfState";
import type { Character } from "@/lib/db/types";

describe("singleplayer head of state seating", () => {
  it("uses the governing executive for UK and Germany", () => {
    expect(getSingleplayerHeadOfStateOfficeType("UK", "2023-default")).toBe("primeMinister");
    expect(getSingleplayerHeadOfStateOfficeType("DE", "2023-default")).toBe("chancellor");
  });

  it("writes the player into the authored presidential office", async () => {
    const characterId = new ObjectId();
    const character = {
      _id: characterId,
      countryId: "US",
      name: "Local President",
      party: "Democratic Party",
    } as unknown as Character;
    const characters = {
      findOne: vi.fn().mockResolvedValue(character),
      updateMany: vi.fn().mockResolvedValue({}),
      updateOne: vi.fn().mockResolvedValue({}),
    };
    const electedOfficials = {
      updateMany: vi.fn().mockResolvedValue({}),
      updateOne: vi.fn().mockResolvedValue({}),
    };
    const npps = { updateMany: vi.fn().mockResolvedValue({}) };
    const db = {
      collection: vi.fn((name: string) =>
        name === "characters" ? characters : name === "npps" ? npps : electedOfficials
      ),
    };

    await expect(
      seatSingleplayerHeadOfState(db as never, {
        characterId,
        countryId: "US",
        now: new Date("2026-01-01T00:00:00Z"),
      })
    ).resolves.toBe(true);

    expect(electedOfficials.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ officeType: "president" }),
      expect.objectContaining({
        $set: expect.objectContaining({ characterId, characterName: "Local President" }),
        $unset: { nppId: "" },
      }),
      { upsert: true }
    );
    expect(npps.updateMany).toHaveBeenCalledWith(
      { countryId: "US", "currentOffice.type": "president" },
      { $set: { currentOffice: null, updatedAt: expect.any(Date) } }
    );
    expect(characters.updateOne).toHaveBeenCalledWith(
      { _id: characterId },
      expect.objectContaining({
        $set: { currentOffice: { type: "president" }, updatedAt: expect.any(Date) },
      })
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { applyMediaEditorialEffects } from "./applyEffects";

function cursor<T>(docs: T[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

describe("applyMediaEditorialEffects", () => {
  it("applies one bounded aligned-candidate nudge and records a retry receipt", async () => {
    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const characterId = new ObjectId();
    const character: {
      _id: ObjectId;
      favorability: number;
      mediaEditorialLastAppliedTurn?: number;
    } = { _id: characterId, favorability: 50 };
    const bulkWrite = vi.fn(async (operations) => {
      for (const operation of operations) {
        character.favorability += operation.updateOne.update.$inc?.favorability ?? 0;
        character.mediaEditorialLastAppliedTurn =
          operation.updateOne.update.$set.mediaEditorialLastAppliedTurn;
      }
    });
    const db = {
      collection(name: string) {
        if (name === "elections")
          return {
            find: () =>
              cursor([{ _id: electionId, countryId: "US", state: "CA", status: "active" }]),
          };
        if (name === "electionCandidates") {
          return {
            find: () =>
              cursor([
                {
                  _id: candidateId,
                  electionId,
                  characterId,
                  party: "1",
                  status: "active",
                },
              ]),
          };
        }
        if (name === "politicalParties") {
          return {
            find: () =>
              cursor([
                {
                  _id: new ObjectId(),
                  countryId: "US",
                  sequentialId: 1,
                  name: "Aligned",
                  abbreviation: "AL",
                  economicPosition: 2,
                  socialPosition: -1,
                },
              ]),
          };
        }
        if (name === "characters") {
          return {
            find: () => cursor([{ ...character }]),
            bulkWrite,
          };
        }
        return { find: () => cursor([]), bulkWrite: vi.fn() };
      },
    };
    const input = {
      db: db as never,
      turn: 10,
      outletsByState: new Map([
        [
          "CA",
          [{ corporationId: "media-corp", stance: { economic: 2, social: -1 }, audienceShare: 1 }],
        ],
      ]),
    };

    await applyMediaEditorialEffects(input);
    await applyMediaEditorialEffects(input);

    expect(character.favorability).toBe(50.5);
    expect(character.mediaEditorialLastAppliedTurn).toBe(10);
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const firstUpdate = bulkWrite.mock.calls[0]?.[0][0].updateOne;
    expect(firstUpdate.filter.$or).toContainEqual({ mediaEditorialLastAppliedTurn: { $lt: 10 } });
  });
});

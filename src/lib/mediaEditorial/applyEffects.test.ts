import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { applyMediaEditorialEffects } from "./applyEffects";

function cursor<T>(docs: T[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

function fixture(
  character: { _id: ObjectId; favorability?: number; mediaEditorialLastAppliedTurn?: number },
  beforeApply?: () => void
) {
  const electionId = new ObjectId();
  const characterId = character._id;
  const bulkWrite = vi.fn(async (operations) => {
    for (const operation of operations) {
      if (
        character.mediaEditorialLastAppliedTurn != null &&
        character.mediaEditorialLastAppliedTurn >= 10
      ) {
        continue;
      }
      beforeApply?.();
      const [stage] = operation.updateOne.update;
      const expression = stage.$set.favorability.$min[1].$add;
      const current = expression[0].$ifNull[0] === "$favorability" ? character.favorability : 50;
      const base = current ?? expression[0].$ifNull[1];
      character.favorability = Math.min(stage.$set.favorability.$min[0], base + expression[1]);
      character.mediaEditorialLastAppliedTurn = stage.$set.mediaEditorialLastAppliedTurn;
    }
  });
  const db = {
    collection(name: string) {
      if (name === "elections")
        return {
          find: () => cursor([{ _id: electionId, countryId: "US", state: "CA", status: "active" }]),
        };
      if (name === "electionCandidates") {
        return {
          find: () =>
            cursor([
              {
                _id: new ObjectId(),
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
  return { input, bulkWrite, character };
}

describe("applyMediaEditorialEffects", () => {
  it("applies one bounded aligned-candidate nudge and records a retry receipt", async () => {
    const state = fixture({ _id: new ObjectId(), favorability: 50 });

    await applyMediaEditorialEffects(state.input);
    await applyMediaEditorialEffects(state.input);

    expect(state.character.favorability).toBe(50.5);
    expect(state.character.mediaEditorialLastAppliedTurn).toBe(10);
    expect(state.bulkWrite).toHaveBeenCalledTimes(2);
    const update = state.bulkWrite.mock.calls[0]?.[0][0].updateOne;
    expect(update.filter.$or).toContainEqual({ mediaEditorialLastAppliedTurn: { $lt: 10 } });
    expect(update.update[0].$set.favorability.$min[1].$add[0].$ifNull).toEqual([
      "$favorability",
      50,
    ]);
  });

  it("uses 50 as the live default when favorability is missing", async () => {
    const state = fixture({ _id: new ObjectId() });

    await applyMediaEditorialEffects(state.input);

    expect(state.character.favorability).toBe(50.5);
  });

  it("caps the live value after a concurrent favorability increase", async () => {
    const state = fixture({ _id: new ObjectId(), favorability: 99.6 }, () => {
      state.character.favorability = (state.character.favorability ?? 50) + 0.3;
    });

    await applyMediaEditorialEffects(state.input);

    expect(state.character.favorability).toBe(100);
  });
});

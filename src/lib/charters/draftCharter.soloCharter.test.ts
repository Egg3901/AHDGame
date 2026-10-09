import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

const ratifyCharter = vi.fn().mockResolvedValue({ partyId: "1" });
vi.mock("./ratifyCharter", () => ({ ratifyCharter }));

import { draftCharter, type DraftCharterInput } from "./draftCharter";

function makeDb(founderIds: ObjectId[]) {
  const insertOne = vi.fn().mockResolvedValue({});
  const collection = vi.fn().mockImplementation((name: string) => {
    if (name === "characters") {
      return {
        find: () => ({
          project: () => ({
            toArray: vi.fn().mockResolvedValue(
              founderIds.map((_id) => ({
                _id,
                userId: new ObjectId(),
                countryId: "US",
                homeState: "CA",
              }))
            ),
          }),
        }),
      };
    }
    if (name === "politicalParties") return { findOne: vi.fn().mockResolvedValue(null) };
    if (name === "partyCharters") return { findOne: vi.fn().mockResolvedValue(null), insertOne };
    if (name === "countryGameStates") {
      return { find: () => ({ toArray: vi.fn().mockResolvedValue([]) }) };
    }
    if (name === "gameState") {
      return { findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: 50 }) };
    }
    return {};
  });
  return { db: { collection } as unknown as Db, insertOne };
}

const base: Omit<DraftCharterInput, "foundersCharacterIds" | "proposedBy"> = {
  countryId: "US",
  proposedName: "Solo Test Party",
  proposedAbbr: "STP",
  platform: { economic: 0, social: 0 },
};

describe("draftCharter solo charter testing flag", () => {
  beforeEach(() => {
    ratifyCharter.mockClear();
    vi.stubEnv("RAILWAY_SERVICE_NAME", "Sandbox Staging");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("flag unset: one founder is rejected with founders-not-3", async () => {
    const id = new ObjectId();
    const { db, insertOne } = makeDb([id]);
    const result = await draftCharter({ ...base, foundersCharacterIds: [id], proposedBy: id }, db);
    expect(result).toEqual({ ok: false, reason: "founders-not-3" });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("flag unset: two founders are rejected with founders-not-3", async () => {
    const ids = [new ObjectId(), new ObjectId()];
    const { db } = makeDb(ids);
    const result = await draftCharter(
      { ...base, foundersCharacterIds: ids, proposedBy: ids[0]! },
      db
    );
    expect(result).toEqual({ ok: false, reason: "founders-not-3" });
  });

  it("flag set: a single founder drafts and ratifies immediately", async () => {
    vi.stubEnv("AHD_SANDBOX_SOLO_CHARTER", "1");
    const id = new ObjectId();
    const { db, insertOne } = makeDb([id]);
    const result = await draftCharter({ ...base, foundersCharacterIds: [id], proposedBy: id }, db);
    expect(result.ok).toBe(true);
    expect(insertOne.mock.calls[0]![0]!.foundersCharacterIds).toHaveLength(1);
    expect(ratifyCharter).toHaveBeenCalledTimes(1);
  });

  it("flag set: a proposer plus an unsigned co-founder waits for the signature", async () => {
    vi.stubEnv("AHD_SANDBOX_SOLO_CHARTER", "true");
    const ids = [new ObjectId(), new ObjectId()];
    const { db } = makeDb(ids);
    const result = await draftCharter(
      { ...base, foundersCharacterIds: ids, proposedBy: ids[0]! },
      db
    );
    expect(result.ok).toBe(true);
    expect(ratifyCharter).not.toHaveBeenCalled();
  });

  it("flag set: zero or four founders are still rejected", async () => {
    vi.stubEnv("AHD_SANDBOX_SOLO_CHARTER", "1");
    const ids = [new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId()];
    const { db } = makeDb(ids);
    expect(
      await draftCharter({ ...base, foundersCharacterIds: [], proposedBy: ids[0]! }, db)
    ).toEqual({ ok: false, reason: "founders-not-3" });
    expect(
      await draftCharter({ ...base, foundersCharacterIds: ids, proposedBy: ids[0]! }, db)
    ).toEqual({ ok: false, reason: "founders-not-3" });
  });

  it("flag set on the production service: still requires 3 founders", async () => {
    vi.stubEnv("AHD_SANDBOX_SOLO_CHARTER", "1");
    vi.stubEnv("RAILWAY_SERVICE_NAME", "Main Site");
    const id = new ObjectId();
    const { db } = makeDb([id]);
    const result = await draftCharter({ ...base, foundersCharacterIds: [id], proposedBy: id }, db);
    expect(result).toEqual({ ok: false, reason: "founders-not-3" });
  });
});

import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { finaliseManifestosAtElectionCall } from "./manifestoLifecycle";
import type { Manifesto } from "@/lib/db/types/manifesto";

/**
 * Minimal in-memory stand-in for the manifestos collection, keyed by
 * (countryId, electionId, party) — enough for findOne + upsert/updateOne with
 * $set/$setOnInsert, so the lifecycle can be exercised end-to-end without Mongo.
 */
function fakeDb() {
  const docs: Manifesto[] = [];
  const match = (d: Manifesto, f: Record<string, unknown>) =>
    d.countryId === f.countryId &&
    String(d.electionId) === String(f.electionId) &&
    d.party === f.party;

  const collection = () => ({
    async findOne(filter: Record<string, unknown>) {
      return docs.find((d) => match(d, filter)) ?? null;
    },
    async updateOne(
      filter: Record<string, unknown>,
      update: { $set?: Partial<Manifesto>; $setOnInsert?: Partial<Manifesto> },
      opts?: { upsert?: boolean }
    ) {
      let doc = docs.find((d) => match(d, filter));
      if (!doc && opts?.upsert) {
        doc = { pledges: [], lockedAt: null } as unknown as Manifesto;
        Object.assign(doc, update.$setOnInsert);
        docs.push(doc);
      }
      if (doc) Object.assign(doc, update.$set);
    },
  });

  return { db: { collection } as never, docs };
}

const countryId = "UK" as const;

describe("finaliseManifestosAtElectionCall", () => {
  it("auto-generates and locks an NPP manifesto", async () => {
    const { db, docs } = fakeDb();
    const res = await finaliseManifestosAtElectionCall(db, {
      countryId,
      electionId: new ObjectId(),
      parties: [{ party: "npp1", isNpp: true, economic: -4, social: -1 }],
      now: new Date(),
    });
    expect(res.generatedNppParties).toEqual(["npp1"]);
    const doc = docs.find((d) => d.party === "npp1")!;
    expect(doc.isNPP).toBe(true);
    expect(doc.pledges).toHaveLength(3);
    expect(doc.lockedAt).toBeInstanceOf(Date);
  });

  it("locks a player party's complete draft", async () => {
    const { db, docs } = fakeDb();
    const electionId = new ObjectId();
    // Seed a complete valid draft.
    docs.push({
      countryId,
      electionId,
      party: "1",
      pledges: [
        { catalogEntryId: "uk.nhs.universal" },
        { catalogEntryId: "uk.economy.soundMoney" },
        { catalogEntryId: "uk.education.secondaryForAll" },
      ],
      authorCharacterId: null,
      isNPP: false,
      lockedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await finaliseManifestosAtElectionCall(db, {
      countryId,
      electionId,
      parties: [{ party: "1", isNpp: false }],
      now: new Date(),
    });
    expect(res.lockedPlayerParties).toEqual(["1"]);
    expect(docs[0].lockedAt).toBeInstanceOf(Date);
  });

  it("skips a player party with no draft (never invents pledges)", async () => {
    const { db } = fakeDb();
    const res = await finaliseManifestosAtElectionCall(db, {
      countryId,
      electionId: new ObjectId(),
      parties: [{ party: "2", isNpp: false }],
      now: new Date(),
    });
    expect(res.skipped).toEqual(["2"]);
    expect(res.lockedPlayerParties).toEqual([]);
  });

  it("skips a player party whose draft is incomplete", async () => {
    const { db, docs } = fakeDb();
    const electionId = new ObjectId();
    docs.push({
      countryId,
      electionId,
      party: "3",
      pledges: [{ catalogEntryId: "uk.nhs.universal" }], // only 1 of 3
      authorCharacterId: null,
      isNPP: false,
      lockedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await finaliseManifestosAtElectionCall(db, {
      countryId,
      electionId,
      parties: [{ party: "3", isNpp: false }],
      now: new Date(),
    });
    expect(res.skipped).toEqual(["3"]);
    expect(docs[0].lockedAt).toBeNull();
  });

  it("leaves an already-locked manifesto untouched", async () => {
    const { db, docs } = fakeDb();
    const electionId = new ObjectId();
    const lockedAt = new Date("2026-01-01");
    docs.push({
      countryId,
      electionId,
      party: "npp1",
      pledges: [{ catalogEntryId: "uk.nhs.universal" }],
      authorCharacterId: null,
      isNPP: true,
      lockedAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await finaliseManifestosAtElectionCall(db, {
      countryId,
      electionId,
      parties: [{ party: "npp1", isNpp: true, economic: -4, social: -1 }],
      now: new Date(),
    });
    expect(res.skipped).toEqual(["npp1"]);
    expect(docs[0].lockedAt).toBe(lockedAt); // unchanged
  });
});

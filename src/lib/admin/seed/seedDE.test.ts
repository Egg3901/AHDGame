import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/npp/seedHistorical", () => ({
  seedFromSeats: vi.fn().mockResolvedValue({ nppsCreated: 16, officialsCreated: 16 }),
}));

vi.mock("@/lib/constants/historicalSeats", () => ({
  DE_BUNDESTAG_2021: [{ state: "BW", officeType: "bundestag", party: "de_spd", seatsHeld: 7 }],
  DE_MINISTERPRAESIDENTEN_2020: [
    { state: "BW", officeType: "ministerPresident", party: "de_greens" },
  ],
}));

import { seedDEBundestag2021, seedDEMinisterPresidents2020 } from "./seedDE";

describe("seedDEBundestag2021", () => {
  let db: MockDb;
  let log: ReturnType<typeof vi.fn<(msg: string) => void>>;

  beforeEach(() => {
    db = createMockDb();
    log = vi.fn<(msg: string) => void>();
  });

  it("seeds without reset and logs completion", async () => {
    await seedDEBundestag2021(db as never, false, log);

    const messages = log.mock.calls.map((c) => c[0]);
    expect(messages.some((m) => /Seeded DE Bundestag/.test(m))).toBe(true);
    expect(messages.some((m) => /Reset:/.test(m))).toBe(false);
  });

  it("performs scoped reset cleanup before seeding", async () => {
    const fakeNppId = new ObjectId();
    // Pre-create the cached mock, then override its `find` to yield one official.
    const officialsMock = db.collection("electedOfficials");
    officialsMock.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ nppId: fakeNppId }]),
      }),
    });

    await seedDEBundestag2021(db as never, true, log);

    const officials = db.collectionMocks.electedOfficials!;
    const npps = db.collectionMocks.npps!;

    // deleteMany scoped to NPP-flagged Bundestag officials only
    expect(officials.deleteMany).toHaveBeenCalledWith({
      countryId: "DE",
      officeType: "bundestag",
      isNPP: true,
    });

    // updateMany scoped to bundestag office type — preserves NPPs who moved
    expect(npps.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [fakeNppId] }, "currentOffice.type": "bundestag" },
      expect.objectContaining({ $set: expect.objectContaining({ retiredAt: expect.any(Date) }) })
    );

    const messages = log.mock.calls.map((c) => c[0]);
    expect(messages.some((m) => /Reset:/.test(m))).toBe(true);
    expect(messages.some((m) => /Seeded DE Bundestag/.test(m))).toBe(true);
  });

  it("skips updateMany when no NPP officials need retiring", async () => {
    // Default mock returns [] — no nppIds collected
    await seedDEBundestag2021(db as never, true, log);

    const npps = db.collectionMocks.npps;
    if (npps) {
      expect(npps.updateMany).not.toHaveBeenCalled();
    }
  });
});

describe("seedDEMinisterPresidents2020", () => {
  let db: MockDb;
  let log: ReturnType<typeof vi.fn<(msg: string) => void>>;

  beforeEach(() => {
    db = createMockDb();
    log = vi.fn<(msg: string) => void>();
  });

  it("seeds without reset and logs completion", async () => {
    await seedDEMinisterPresidents2020(db as never, false, log);

    const messages = log.mock.calls.map((c) => c[0]);
    expect(messages.some((m) => /Seeded DE Minister-Presidents/.test(m))).toBe(true);
    expect(messages.some((m) => /Reset:/.test(m))).toBe(false);
  });

  it("performs scoped reset cleanup before seeding", async () => {
    const fakeNppId = new ObjectId();
    const officialsMock = db.collection("electedOfficials");
    officialsMock.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ nppId: fakeNppId }]),
      }),
    });

    await seedDEMinisterPresidents2020(db as never, true, log);

    const officials = db.collectionMocks.electedOfficials!;
    const npps = db.collectionMocks.npps!;

    expect(officials.deleteMany).toHaveBeenCalledWith({
      countryId: "DE",
      officeType: "ministerPresident",
      isNPP: true,
    });

    expect(npps.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [fakeNppId] }, "currentOffice.type": "ministerPresident" },
      expect.objectContaining({ $set: expect.objectContaining({ retiredAt: expect.any(Date) }) })
    );

    const messages = log.mock.calls.map((c) => c[0]);
    expect(messages.some((m) => /Reset:/.test(m))).toBe(true);
    expect(messages.some((m) => /Seeded DE Minister-Presidents/.test(m))).toBe(true);
  });
});

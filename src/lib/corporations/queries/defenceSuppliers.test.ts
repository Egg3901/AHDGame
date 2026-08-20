import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { listDefenceSuppliers } from "./defenceSuppliers";

const CORP_ID = new ObjectId();

interface World {
  sectors: Record<string, unknown>[];
  corps: Record<string, unknown>[];
  contracts: Record<string, unknown>[];
}

function stubDb(w: World): Db {
  return {
    collection: (name: string) => {
      if (name === "corporateSectors") {
        return {
          find: (f: Record<string, unknown> = {}) => ({
            toArray: async () => {
              let rows = w.sectors.filter((s) => s.sectorType === f.sectorType);
              const corpFilter = f.corporationId as { $in?: { toString(): string }[] } | undefined;
              if (corpFilter?.$in) {
                const ids = new Set(corpFilter.$in.map((id) => id.toString()));
                rows = rows.filter((s) => ids.has((s.corporationId as ObjectId).toString()));
              }
              if (typeof f.countryId === "string") {
                rows = rows.filter((s) => s.countryId === f.countryId);
              }
              return rows;
            },
          }),
        };
      }
      if (name === "corporations") {
        return {
          find: (f: Record<string, unknown> = {}) => ({
            toArray: async () => {
              if (typeof f.countryId === "string") {
                return w.corps.filter((c) => c.countryId === f.countryId);
              }
              const idFilter = f._id as { $in?: { toString(): string }[] } | undefined;
              if (idFilter?.$in) {
                const ids = new Set(idFilter.$in.map((id) => id.toString()));
                return w.corps.filter((c) => ids.has((c._id as ObjectId).toString()));
              }
              return w.corps;
            },
          }),
        };
      }
      // defenceContracts
      return {
        find: () => ({
          toArray: async () => w.contracts,
          sort: () => ({ toArray: async () => w.contracts }),
        }),
      };
    },
  } as unknown as Db;
}

const sector = (over: Record<string, unknown> = {}) => ({
  _id: new ObjectId(),
  corporationId: CORP_ID,
  countryId: "US",
  stateId: "TX",
  sectorType: "defense",
  strategyId: "heavy_armor",
  revenue: 10_000_000,
  ...over,
});

const corp = (over: Record<string, unknown> = {}) => ({
  _id: CORP_ID,
  name: "Lockmartin",
  countryId: "US",
  liquidCurrencyCode: "USD",
  unlockedTechNodeIds: [],
  ...over,
});

const world = (over: Partial<World> = {}): World => ({
  sectors: [sector()],
  corps: [corp()],
  contracts: [],
  ...over,
});

// The country's anchored lot price. Build cost is a share of it (ticket #1134),
// so the picker needs it to quote a cost at all.
const LOT_PRICE = 380_000_000;

describe("listDefenceSuppliers", () => {
  it("offers a domestic defence plant on a materiel line", async () => {
    const rows = await listDefenceSuppliers(stubDb(world()), "US", 1953, LOT_PRICE);
    expect(rows).toHaveLength(1);
    expect(rows[0].corporationName).toBe("Lockmartin");
    expect(rows[0].component).toBe("ground");
    expect(rows[0].projectedLotsPerTurn).toBeGreaterThan(0);
  });

  // Every filter below mirrors a rejection the award route already makes. A picker that
  // offered one of these would turn a clear 400 into an option the minister cannot diagnose.
  it("omits a plant whose line builds no materiel", async () => {
    const rows = await listDefenceSuppliers(
      stubDb(world({ sectors: [sector({ strategyId: "cyber" })] })),
      "US",
      1953,
      LOT_PRICE
    );
    expect(rows).toHaveLength(0);
  });

  it("omits a foreign-owned supplier", async () => {
    const rows = await listDefenceSuppliers(
      stubDb(world({ corps: [corp({ countryId: "UK" })] })),
      "US",
      1953,
      LOT_PRICE
    );
    expect(rows).toHaveLength(0);
  });

  it("omits a supplier paid in another currency", async () => {
    const rows = await listDefenceSuppliers(
      stubDb(world({ corps: [corp({ liquidCurrencyCode: "GBP" })] })),
      "US",
      1953,
      LOT_PRICE
    );
    expect(rows).toHaveLength(0);
  });

  // Ticket #1087: a Soviet plant whose NatCorp never got liquidCurrencyCode used to vanish
  // because canSupply treated the missing field as USD against a SUR appropriation.
  it("offers a domestic plant whose currency is inferred from country", async () => {
    const ruId = new ObjectId();
    const rows = await listDefenceSuppliers(
      stubDb({
        sectors: [
          {
            _id: new ObjectId(),
            corporationId: ruId,
            countryId: "RU",
            stateId: "MOS",
            sectorType: "defense",
            strategyId: "heavy_armor",
            revenue: 10_000_000,
          },
        ],
        corps: [{ _id: ruId, name: "Ministries of Defence Industry", countryId: "RU" }],
        contracts: [],
      }),
      "RU",
      1953,
      LOT_PRICE
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].corporationName).toBe("Ministries of Defence Industry");
  });

  // Ticket #1134: a vacant NatCorp CEO cannot re-allocate lines, so the picker must
  // project the full remaining plant, not the private even-split default.
  it("projects a state-owned two-domain plant at full remaining output", async () => {
    const ruId = new ObjectId();
    const soeSector = {
      _id: new ObjectId(),
      corporationId: ruId,
      countryId: "RU",
      stateId: "MOS",
      sectorType: "defense",
      strategyId: "standard",
      revenue: 10_000_000,
    };
    const rows = await listDefenceSuppliers(
      stubDb({
        sectors: [soeSector],
        corps: [
          {
            _id: ruId,
            name: "Ministries of Defence Industry",
            countryId: "RU",
            countryOwnerId: "RU",
            ownershipState: "stateOwned",
          },
        ],
        contracts: [],
      }),
      "RU",
      1953,
      LOT_PRICE
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].stateOwned).toBe(true);
    expect(rows[0].projectedLotsPerTurn).toBeGreaterThan(0);
    const privateRows = await listDefenceSuppliers(
      stubDb(
        world({
          sectors: [sector({ strategyId: "standard", revenue: 10_000_000 })],
        })
      ),
      "US",
      1953,
      LOT_PRICE
    );
    expect(rows[0].projectedLotsPerTurn).toBeCloseTo(privateRows[0].projectedLotsPerTurn * 2, 6);
  });

  it("omits a non-defence plant", async () => {
    const rows = await listDefenceSuppliers(
      stubDb(world({ sectors: [sector({ sectorType: "manufacturing" })] })),
      "US",
      1953,
      LOT_PRICE
    );
    expect(rows).toHaveLength(0);
  });

  // Marked, not removed — a second order on one plant is legal, just rarely intended.
  it("flags a plant that already carries a contract, without hiding it", async () => {
    const s = sector();
    const rows = await listDefenceSuppliers(
      stubDb(
        world({
          sectors: [s],
          contracts: [{ _id: new ObjectId(), sectorId: s._id, corporationId: CORP_ID }],
        })
      ),
      "US",
      1953,
      LOT_PRICE
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].alreadyContracted).toBe(true);
  });

  it("puts uncommitted and more productive plants first", async () => {
    const busy = sector({ revenue: 90_000_000 });
    const free = sector({ revenue: 10_000_000 });
    const rows = await listDefenceSuppliers(
      stubDb(
        world({
          sectors: [busy, free],
          contracts: [{ _id: new ObjectId(), sectorId: busy._id, corporationId: CORP_ID }],
        })
      ),
      "US",
      1953,
      LOT_PRICE
    );
    // The busier plant produces more, but the free one is the one a minister can actually use.
    expect(rows[0].sectorId).toBe(free._id.toString());
    expect(rows[1].alreadyContracted).toBe(true);
  });

  it("prefers a CEO's own plant name over the state it sits in", async () => {
    const rows = await listDefenceSuppliers(
      stubDb(world({ sectors: [sector({ displayName: "Fort Worth Works" })] })),
      "US",
      1953,
      LOT_PRICE
    );
    expect(rows[0].plantLabel).toBe("Fort Worth Works");
  });

  it("falls back to the state when the plant is unnamed", async () => {
    const rows = await listDefenceSuppliers(
      stubDb(world({ sectors: [sector({ displayName: "  " })] })),
      "US",
      1953,
      LOT_PRICE
    );
    expect(rows[0].plantLabel).toBe("TX");
  });

  // Ticket #1149. Delivery already accepted a home-country corp's overseas plant
  // (`canSupply` keys on HQ / currency, not host state). The picker filtered sectors by
  // `countryId`, so a UK minister could only award Streibl's tiny domestic line while the
  // same corp's Greek works never appeared — and 4 production lines on that domestic plant
  // still only yielded 0.02 lots/turn.
  it("offers a domestic corporation's overseas plant", async () => {
    const overseas = sector({ countryId: "GR", stateId: "GR_ATT", revenue: 9_000_000 });
    const home = sector({ countryId: "UK", stateId: "SEE", revenue: 2_000 });
    const rows = await listDefenceSuppliers(
      stubDb(
        world({
          sectors: [overseas, home],
          corps: [corp({ countryId: "UK", liquidCurrencyCode: "GBP" })],
        })
      ),
      "UK",
      1953,
      LOT_PRICE
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].sectorId).toBe(overseas._id.toString());
    expect(rows[0].plantLabel).toBe("GR_ATT (GR)");
    expect(rows[0].projectedLotsPerTurn).toBeGreaterThan(rows[1].projectedLotsPerTurn);
    expect(rows[1].plantLabel).toBe("SEE");
  });

  it("still omits a foreign-owned plant that happens to sit in the buying country", async () => {
    const rows = await listDefenceSuppliers(
      stubDb(
        world({
          sectors: [sector({ countryId: "UK", stateId: "SEE" })],
          corps: [corp({ countryId: "GR", liquidCurrencyCode: "GRD" })],
        })
      ),
      "UK",
      1953,
      LOT_PRICE
    );
    expect(rows).toHaveLength(0);
  });
});

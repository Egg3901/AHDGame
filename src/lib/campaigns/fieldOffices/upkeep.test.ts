import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/campaigns/campaignCurrency", () => ({
  loadCampaignCurrencyRates: vi.fn().mockResolvedValue({}),
  loadCampaignPriceLevel: vi.fn().mockResolvedValue(1),
  campaignAnchorToLocal: (anchor: number) => anchor,
}));
vi.mock("@/lib/db/collections/gameState", () => ({
  getGameStatePresetOrDefault: vi.fn().mockResolvedValue("1991-default"),
}));

import { processFieldOfficeUpkeep } from "./upkeep";
import { getFieldOfficeCostAnchor, getFieldOfficeRules } from "./rules";

type Row = Record<string, unknown> & { _id: ObjectId };

function matches(row: Row, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === "object" && "$in" in (v as object)) {
      return (v as { $in: unknown[] }).$in.some((x) => String(x) === String(row[k]));
    }
    return String(row[k]) === String(v);
  });
}

function stubDb(collections: Record<string, Row[]>) {
  const bulk: unknown[] = [];
  const db = {
    collection(name: string) {
      const rows = (collections[name] ??= []);
      return {
        find: (filter: Record<string, unknown> = {}) => ({
          toArray: async () => rows.filter((r) => matches(r, filter)),
        }),
        deleteMany: async (filter: Record<string, unknown>) => {
          const keep = rows.filter((r) => !matches(r, filter));
          const deletedCount = rows.length - keep.length;
          rows.splice(0, rows.length, ...keep);
          return { deletedCount };
        },
        bulkWrite: async (ops: unknown[]) => {
          bulk.push(...ops);
          return {};
        },
      };
    },
  } as unknown as Db;
  return { db, bulk, collections };
}

const rules = getFieldOfficeRules("US")!;
const upkeep = getFieldOfficeCostAnchor(rules, "senate").upkeep;

function office(campaignId: ObjectId, electionId: ObjectId, openedTurn: number): Row {
  return {
    _id: new ObjectId(),
    campaignId,
    electionId,
    openedTurn,
    createdAt: new Date(openedTurn * 1000),
  };
}

describe("processFieldOfficeUpkeep", () => {
  let campaignId: ObjectId;
  let electionId: ObjectId;
  beforeEach(() => {
    campaignId = new ObjectId();
    electionId = new ObjectId();
  });

  it("charges upkeep per office and rewrites the office count", async () => {
    const { db, bulk } = stubDb({
      campaignFieldOffices: [office(campaignId, electionId, 1), office(campaignId, electionId, 2)],
      campaigns: [{ _id: campaignId, funds: 1_000_000, status: "active" }],
      elections: [{ _id: electionId, status: "active", countryId: "US", electionType: "senate" }],
    });
    const res = await processFieldOfficeUpkeep(db);
    expect(res).toEqual({ campaignsCharged: 1, officesClosedInsolvent: 0, officesSwept: 0 });
    const op = bulk[0] as { updateOne: { update: { $inc: { funds: number }; $set: object } } };
    expect(op.updateOne.update.$inc.funds).toBe(-2 * upkeep);
    expect(op.updateOne.update.$set).toEqual({ fieldOfficeCount: 2 });
  });

  it("closes the newest offices first when the campaign cannot pay", async () => {
    const oldest = office(campaignId, electionId, 1);
    const newest = office(campaignId, electionId, 5);
    const { db, collections } = stubDb({
      campaignFieldOffices: [newest, oldest],
      campaigns: [{ _id: campaignId, funds: upkeep * 1.5, status: "active" }],
      elections: [{ _id: electionId, status: "active", countryId: "US", electionType: "senate" }],
    });
    const res = await processFieldOfficeUpkeep(db);
    expect(res.officesClosedInsolvent).toBe(1);
    expect(collections.campaignFieldOffices.map((o) => o._id)).toEqual([oldest._id]);
  });

  it("sweeps offices whose campaign or race is gone", async () => {
    const otherElection = new ObjectId();
    const { db, collections } = stubDb({
      campaignFieldOffices: [
        office(campaignId, electionId, 1),
        office(new ObjectId(), otherElection, 1),
      ],
      campaigns: [{ _id: campaignId, funds: 0, status: "active" }],
      elections: [
        { _id: electionId, status: "completed", countryId: "US", electionType: "senate" },
        { _id: otherElection, status: "active", countryId: "US", electionType: "senate" },
      ],
    });
    const res = await processFieldOfficeUpkeep(db);
    expect(res.officesSwept).toBe(2);
    expect(collections.campaignFieldOffices).toHaveLength(0);
  });
});

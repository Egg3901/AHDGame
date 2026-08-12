import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { processLabourRelationsTurn } from "./labourRelationsTurn";
import {
  BARGAINING_DISPUTE_MAX_TURNS,
  OVERTIME_BAN_UPKEEP_PER_LOCAL,
} from "@/lib/unions/bargaining";

const createNotifications = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/notifications", () => ({ createNotifications }));

type Doc = Record<string, unknown>;

function get(doc: Doc, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value == null || typeof value !== "object") return undefined;
    return (value as Doc)[key];
  }, doc);
}

function set(doc: Doc, path: string, value: unknown): void {
  const keys = path.split(".");
  let target = doc;
  for (const key of keys.slice(0, -1)) {
    if (typeof target[key] !== "object" || target[key] == null) target[key] = {};
    target = target[key] as Doc;
  }
  target[keys[keys.length - 1]] = value;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
  return left === right;
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    const value = get(doc, key);
    if (condition && typeof condition === "object" && !(condition instanceof ObjectId)) {
      return Object.entries(condition as Doc).every(([op, operand]) => {
        if (op === "$in") return (operand as unknown[]).some((item) => sameValue(item, value));
        if (op === "$nin") return !(operand as unknown[]).some((item) => sameValue(item, value));
        if (op === "$lte") return typeof value === "number" && value <= (operand as number);
        if (op === "$gt") return typeof value === "number" && value > (operand as number);
        if (op === "$gte") return typeof value === "number" && value >= (operand as number);
        if (op === "$ne") return !sameValue(value, operand);
        if (op === "$exists") return (value !== undefined) === operand;
        throw new Error(`unsupported operator ${op}`);
      });
    }
    return sameValue(value, condition);
  });
}

function applyUpdate(doc: Doc, update: Doc): void {
  for (const [key, value] of Object.entries((update.$set as Doc) ?? {})) set(doc, key, value);
  for (const key of Object.keys((update.$unset as Doc) ?? {})) delete doc[key];
  for (const [key, value] of Object.entries((update.$inc as Doc) ?? {})) {
    set(doc, key, ((get(doc, key) as number) ?? 0) + (value as number));
  }
}

/** In-memory stand-in supporting exactly the operations this turn pass uses. */
function fakeDb(data: Record<string, Doc[]>): Db {
  const collection = (name: string) => {
    const docs = (data[name] ??= []);
    return {
      find: (filter: Doc = {}) => ({
        toArray: async () => docs.filter((doc) => matches(doc, filter)).map((doc) => ({ ...doc })),
      }),
      findOne: async (filter: Doc = {}) => {
        const found = docs.find((doc) => matches(doc, filter));
        return found ? { ...found } : null;
      },
      updateMany: async (filter: Doc, update: Doc) => {
        const targets = docs.filter((doc) => matches(doc, filter));
        for (const doc of targets) applyUpdate(doc, update);
        return { modifiedCount: targets.length };
      },
      bulkWrite: async (ops: { updateOne: { filter: Doc; update: Doc } }[]) => {
        let modifiedCount = 0;
        for (const op of ops) {
          const target = docs.find((doc) => matches(doc, op.updateOne.filter));
          if (!target) continue;
          applyUpdate(target, op.updateOne.update);
          modifiedCount++;
        }
        return { modifiedCount, matchedCount: modifiedCount };
      },
    };
  };
  return { collection } as unknown as Db;
}

const UNION_ID = new ObjectId();
const SECTOR_ID = new ObjectId();
const EMPLOYER_ID = new ObjectId();
const OWNER_ID = new ObjectId();
const USER_ID = new ObjectId();

beforeEach(() => {
  createNotifications.mockClear();
});

function local(overrides: Doc = {}): Doc {
  return {
    _id: SECTOR_ID,
    stateId: "NY",
    workers: 1000,
    unionization: 60,
    wageLevel: 1,
    workerExpectationIndex: 1.1,
    ...overrides,
  };
}

function campaign(overrides: Doc = {}): Doc {
  return {
    _id: new ObjectId(),
    unionId: UNION_ID,
    countryId: "US",
    sectorType: "manufacturing",
    employerCorporationId: EMPLOYER_ID,
    sectorIds: [SECTOR_ID],
    status: "dispute",
    escalationLevel: "none",
    mandate: {
      coverage: 60,
      grievance: 40,
      laborTightness: 50,
      lawSupport: 50,
      strikeFundRunway: 3,
      support: 55,
      leverage: 55,
      organizedLocalCount: 1,
      totalLocalCount: 1,
    },
    currentOffer: {
      revision: 1,
      proposedBy: "union",
      wageLevel: 1.2,
      agreementDurationTurns: 48,
      noStrikeTurns: 24,
      proposedAtTurn: 100,
      proposedAt: new Date(0),
    },
    offers: [],
    startedAtTurn: 100,
    deadlineTurn: 108,
    disputeStartedAtTurn: 108,
    lastActionTurn: 108,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function baseData(overrides: Partial<Record<string, Doc[]>> = {}) {
  return {
    bargainingCampaigns: [],
    collectiveAgreements: [],
    corporateSectors: [local()],
    unions: [
      { _id: UNION_ID, name: "United Workers", countryId: "US", treasury: 5000, ownerId: OWNER_ID },
    ],
    characters: [{ _id: OWNER_ID, userId: USER_ID }],
    corporations: [{ _id: EMPLOYER_ID, name: "Rand Steel" }],
    macroMetrics: [
      { _id: "NY", economic: { costOfLiving: { value: 110 } } },
      { _id: "us_national", economic: { unemploymentRate: { value: 5 } } },
    ],
    federalBudget: [{ _id: "federal" }],
    ...overrides,
  } as Record<string, Doc[]>;
}

describe("processLabourRelationsTurn", () => {
  it("moves missed deadlines to dispute and expires completed agreements", async () => {
    const data = baseData({
      bargainingCampaigns: [
        campaign({ status: "negotiating", deadlineTurn: 118, disputeStartedAtTurn: undefined }),
      ],
      collectiveAgreements: [{ _id: new ObjectId(), status: "active", expiresAtTurn: 119 }],
    });
    const result = await processLabourRelationsTurn(fakeDb(data), 120);

    expect(result.campaignsMovedToDispute).toBe(1);
    expect(result.agreementsExpired).toBe(1);
    expect(data.bargainingCampaigns[0].status).toBe("dispute");
    expect(data.collectiveAgreements[0].status).toBe("expired");
  });

  it("expires a mediation package that ran out of time", async () => {
    const data = baseData({
      bargainingCampaigns: [
        campaign({
          mediation: { status: "pending", expiresAtTurn: 119, unionAccepted: true },
        }),
      ],
    });
    const result = await processLabourRelationsTurn(fakeDb(data), 120);

    expect(result.mediationsExpired).toBe(1);
    expect((data.bargainingCampaigns[0].mediation as Doc).status).toBe("expired");
  });

  it("refreshes the mandate of a running campaign from live conditions", async () => {
    const data = baseData({ bargainingCampaigns: [campaign()] });
    // The local organized further after the campaign opened.
    data.corporateSectors[0].unionization = 90;

    const result = await processLabourRelationsTurn(fakeDb(data), 112);

    expect(result.mandatesRefreshed).toBe(1);
    const mandate = data.bargainingCampaigns[0].mandate as Doc;
    expect(mandate.coverage).toBe(90);
    expect(data.bargainingCampaigns[0].mandateUpdatedAtTurn).toBe(112);
  });

  it("charges upkeep for a held overtime ban and ends it when the fund runs dry", async () => {
    const funded = baseData({
      bargainingCampaigns: [campaign({ escalationLevel: "overtime_ban" })],
    });
    const fundedResult = await processLabourRelationsTurn(fakeDb(funded), 112);
    expect(fundedResult.overtimeBansFunded).toBe(1);
    expect(funded.unions[0].treasury).toBe(5000 - OVERTIME_BAN_UPKEEP_PER_LOCAL);
    expect(funded.bargainingCampaigns[0].escalationLevel).toBe("overtime_ban");

    const broke = baseData({
      bargainingCampaigns: [campaign({ escalationLevel: "overtime_ban" })],
      unions: [
        { _id: UNION_ID, name: "United Workers", countryId: "US", treasury: 5, ownerId: OWNER_ID },
      ],
    });
    const brokeResult = await processLabourRelationsTurn(fakeDb(broke), 112);
    expect(brokeResult.overtimeBansEnded).toBe(1);
    expect(broke.bargainingCampaigns[0].escalationLevel).toBe("none");
    // Charging for an action and cancelling it are both consequences of turn
    // processing, so the leader has to be told rather than left to notice.
    const defunded = createNotifications.mock.calls.at(-1)?.[0] as {
      userId: ObjectId;
      title: string;
      message: string;
      metadata: Record<string, unknown>;
    }[];
    expect(defunded).toHaveLength(1);
    expect(defunded[0].userId).toBe(USER_ID);
    expect(defunded[0].title).toContain("Overtime ban ended");
    expect(defunded[0].message).toContain("Rand Steel");
    expect(defunded[0].metadata.upkeep).toBe(OVERTIME_BAN_UPKEEP_PER_LOCAL);
  });

  it("lapses a deadlocked dispute and puts forced expectations back", async () => {
    const data = baseData({
      bargainingCampaigns: [
        campaign({
          escalationLevel: "industry_strike",
          escalationExpectations: [{ sectorId: SECTOR_ID, previousExpectationIndex: 0.95 }],
        }),
      ],
      corporateSectors: [local({ workerExpectationIndex: 1.3 })],
    });

    const early = await processLabourRelationsTurn(
      fakeDb(structuredCloneData(data)),
      108 + BARGAINING_DISPUTE_MAX_TURNS - 1
    );
    expect(early.disputesLapsed).toBe(0);

    const result = await processLabourRelationsTurn(
      fakeDb(data),
      108 + BARGAINING_DISPUTE_MAX_TURNS
    );

    expect(result.disputesLapsed).toBe(1);
    expect(data.bargainingCampaigns[0].status).toBe("lapsed");
    expect(data.bargainingCampaigns[0].escalationLevel).toBe("none");
    expect(data.corporateSectors[0].workerExpectationIndex).toBe(0.95);

    const lapsedNotices = createNotifications.mock.calls.at(-1)?.[0] as {
      title: string;
      message: string;
    }[];
    expect(lapsedNotices).toHaveLength(1);
    expect(lapsedNotices[0].title).toBe("Bargaining dispute lapsed");
    expect(lapsedNotices[0].message).toContain("Rand Steel");
  });

  it("does not notify an NPP-led union, which has no user behind the leader", async () => {
    const data = baseData({
      bargainingCampaigns: [campaign()],
      unions: [
        {
          _id: UNION_ID,
          name: "United Workers",
          countryId: "US",
          treasury: 5000,
          ownerId: OWNER_ID,
          ownerType: "npp",
        },
      ],
    });

    await processLabourRelationsTurn(fakeDb(data), 108 + BARGAINING_DISPUTE_MAX_TURNS);

    expect(createNotifications).not.toHaveBeenCalled();
  });
});

function structuredCloneData(data: Record<string, Doc[]>): Record<string, Doc[]> {
  return Object.fromEntries(
    Object.entries(data).map(([key, docs]) => [key, docs.map((doc) => ({ ...doc }))])
  );
}

import { beforeEach, describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
vi.mock("@/lib/corporations/subsidiaries/authorization", () => ({
  canActOnCorporationAsParent: vi.fn(async () => true),
}));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn(async () => null),
}));
import { coordinationFixture } from "./rules/testFixtures";
import { activeGroupDirection } from "./rules/direction";
import { groupOperator } from "./operator";
import { loadGroupDirectionMembership } from "@/lib/turn/npp/groupDirectionMembership";
import { updateGroupManagement, groupManagementView } from "./management";
const rootId = new ObjectId(),
  subId = new ObjectId(),
  parentUser = new ObjectId(),
  playerUser = new ObjectId(),
  outsider = new ObjectId();
const parent = {
  _id: rootId,
  name: "Parent",
  userId: parentUser,
  ceoId: new ObjectId(),
  ceoType: "character",
  totalShares: 100,
  shareholders: [],
  groupManagement: { name: "Group", supplyPolicy: "members" },
};
const sub = {
  _id: subId,
  name: "Player subsidiary",
  userId: playerUser,
  ceoId: new ObjectId(),
  ceoType: "character",
  totalShares: 100,
  shareholders: [{ corporationId: rootId, shares: 75 }],
  subsidiaryFormalizedAtTurn: 1,
};
let memory: InMemoryDb, db: Db;
beforeEach(() => {
  memory = createInMemoryDb();
  memory.seed("corporations", [parent, sub]);
  memory.seed("states", [{ _id: "US-PA", name: "Pennsylvania", countryId: "US" }]);
  memory.seed("gameState", [
    { _id: "current", currentTurn: 40, subsidiaryCorporationsEnabled: true },
  ]);
  db = memory as unknown as Db;
  vi.clearAllMocks();
});
async function doc(id: ObjectId) {
  return (await memory.collection("corporations").findOne({ _id: id })) as unknown as Corporation;
}
describe("group management authorization and persistence", () => {
  it("persists a parent primary-industry mandate and denies outsiders", async () => {
    await memory.collection("corporations").updateOne({ _id: subId }, { $set: { ceoType: "npp" } });
    const command = {
      action: "direction",
      memberId: subId.toString(),
      objective: "expansion",
      regions: [],
      allowInvestment: true,
      primaryIndustryOnly: true,
    } as const;
    expect(
      await updateGroupManagement(db, await doc(rootId), outsider.toString(), {
        ...command,
        regions: [],
      })
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      await updateGroupManagement(db, await doc(rootId), parentUser.toString(), {
        ...command,
        regions: [],
      })
    ).toEqual({ ok: true });
    expect((await doc(subId)).groupDirection?.primaryIndustryOnly).toBe(true);
    const { primaryIndustryOnly: _primaryOnly, ...legacyCommand } = command;
    expect(
      await updateGroupManagement(db, await doc(rootId), parentUser.toString(), {
        ...legacyCommand,
        regions: [],
      })
    ).toEqual({ ok: true });
    expect((await doc(subId)).groupDirection?.primaryIndustryOnly).toBe(true);
    const view = await groupManagementView(db, await doc(rootId), parentUser.toString());
    expect(
      view?.members.find((m) => m.id === subId.toString())?.direction?.primaryIndustryOnly
    ).toBe(true);
  });

  it("activates NPP directions independently while preserving existing active supply routing", async () => {
    memory.seed("gameConfig", [
      { _id: "default", marketSystemMode: "plants", groupSupplyCoordinationEnabled: false },
    ]);
    await memory.collection("corporations").updateOne({ _id: subId }, { $set: { ceoType: "npp" } });
    expect(
      await updateGroupManagement(db, await doc(rootId), parentUser.toString(), {
        action: "direction",
        memberId: subId.toString(),
        objective: "profit",
        regions: [],
        allowInvestment: false,
      })
    ).toEqual({ ok: true });
    const view = await groupManagementView(db, await doc(rootId), parentUser.toString());
    expect(view).toMatchObject({
      directionsEnabled: true,
      internalSupplyEnabled: true,
      supplyEngineEnabled: false,
      forecast: null,
    });
    const child = await doc(subId),
      groups = await loadGroupDirectionMembership(db, true, [child]);
    const root = groups?.rootByCorpId.get(subId.toString());
    expect(groups?.eligibleManagementRoots?.has(root!)).toBe(true);
    expect(
      activeGroupDirection(child.groupDirection, {
        turn: 41,
        ceoId: child.ceoId!.toString(),
        ceoTenureKey: groupOperator(child, root!).ceoTenureKey,
        rootId: root!,
        isNpp: true,
        caretaker: false,
      })
    ).toBe(child.groupDirection);
  });
  it("protects outstanding debt and historical cash with the existing private-access rules", async () => {
    memory.seed("bonds", [
      { _id: new ObjectId(), corporationId: rootId, totalIssued: 100, matured: false },
      { _id: new ObjectId(), corporationId: subId, totalIssued: 200, matured: false },
      { _id: new ObjectId(), corporationId: subId, totalIssued: 900, matured: true },
    ]);
    memory.seed("corporationHistory", [
      {
        _id: new ObjectId(),
        corporationId: subId,
        turn: 40,
        revenue: 200,
        totalCosts: 120,
        income: 80,
        liquidCapital: 1000,
        currencyCode: "GBP",
        fxRateAtWrite: 2,
      },
    ]);
    const owner = await groupManagementView(db, await doc(rootId), parentUser.toString());
    expect(owner?.members.find((m) => m.id === subId.toString())).toMatchObject({
      currentDebtAnchor: 200,
      history: [{ cash: 500, revenue: 100 }],
    });
    const child = await groupManagementView(db, await doc(subId), playerUser.toString());
    expect(child?.members.find((m) => m.id === rootId.toString())).toMatchObject({
      currentDebtAnchor: null,
      history: null,
    });
    const publicView = await groupManagementView(db, await doc(rootId), outsider.toString());
    expect(
      publicView?.members.every((m) => m.currentDebtAnchor === null && m.history === null)
    ).toBe(true);
  });

  it("returns ticker and voting control including unsold reserved holdings", async () => {
    await memory
      .collection("corporations")
      .updateOne(
        { _id: subId },
        { $set: { tickerSymbol: "SUB", shareholders: [{ corporationId: rootId, shares: 40 }] } }
      );
    memory.seed("shareOrders", [
      {
        _id: new ObjectId(),
        corporationId: subId,
        placerCorporationId: rootId,
        type: "sell",
        status: "open",
        sharesRemaining: 35,
      },
    ]);
    const view = await groupManagementView(db, await doc(rootId), parentUser.toString());
    expect(view?.members.find((m) => m.id === subId.toString())).toMatchObject({
      tickerSymbol: "SUB",
      parentControl: { corporationId: rootId.toString(), votingPercent: 75 },
    });
  });

  it("requires fresh consent when the same CEO returns for another tenure", async () => {
    await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
      action: "participation",
      enabled: true,
    });
    await memory
      .collection("gameState")
      .updateOne({ _id: "current" }, { $set: { currentTurn: 50 } });
    await memory.collection("corporations").updateOne(
      { _id: subId },
      {
        $set: {
          ceoHistory: [
            { holderId: sub.ceoId, ceoType: "character", startTurn: 1, endTurn: 45 },
            { holderId: sub.ceoId, ceoType: "character", startTurn: 49 },
          ],
        },
      }
    );
    const view = await groupManagementView(db, await doc(subId), playerUser.toString());
    expect(view?.members.find((m) => m.id === subId.toString())).toMatchObject({
      receiving: false,
      requested: false,
    });
  });

  it("refuses a response to a replaced suggestion from the same turn", async () => {
    const command = {
      action: "direction" as const,
      memberId: subId.toString(),
      objective: "profit" as const,
      regions: [],
      allowInvestment: false,
    };
    await updateGroupManagement(db, await doc(rootId), parentUser.toString(), command);
    const revision = (await doc(subId)).groupDirection!.revision;
    await updateGroupManagement(db, await doc(rootId), parentUser.toString(), {
      ...command,
      objective: "balanced",
    });
    expect(
      await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
        action: "respond",
        response: "acknowledged",
        revision,
      })
    ).toMatchObject({ ok: false, status: 409 });
    expect((await doc(subId)).groupDirection!.response).toBe("pending");
  });

  it("keeps a controlling block while it is reserved in an open sale", async () => {
    await memory
      .collection("corporations")
      .updateOne({ _id: subId }, { $set: { shareholders: [] } });
    memory.seed("shareOrders", [
      {
        _id: new ObjectId(),
        corporationId: subId,
        type: "sell",
        status: "open",
        placerCorporationId: rootId,
        sharesRemaining: 75,
      },
    ]);
    const view = await groupManagementView(db, await doc(rootId), parentUser.toString());
    expect(view?.canManage).toBe(true);
    expect(view?.members).toHaveLength(2);
  });

  it("allows parent identity edits and denies subsidiary/outsider edits", async () => {
    expect(
      await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
        action: "identity",
        name: "Hijack",
      })
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      await updateGroupManagement(db, await doc(rootId), outsider.toString(), {
        action: "policy",
        policy: "independent",
      })
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      await updateGroupManagement(db, await doc(rootId), parentUser.toString(), {
        action: "identity",
        name: "Chosen Group",
      })
    ).toEqual({ ok: true });
    expect((await doc(rootId)).groupManagement?.name).toBe("Chosen Group");
  });
  it("lets only the operating player set next-turn receiving consent", async () => {
    expect(
      await updateGroupManagement(db, await doc(subId), parentUser.toString(), {
        action: "participation",
        enabled: true,
      })
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
        action: "participation",
        enabled: true,
      })
    ).toEqual({ ok: true });
    const saved = (await doc(subId)).groupReceiving;
    expect(saved).toMatchObject({
      enabled: true,
      previousEnabled: false,
      effectiveTurn: 41,
      rootId: rootId.toString(),
      ceoId: sub.ceoId.toString(),
    });
    const own = await groupManagementView(db, await doc(subId), playerUser.toString());
    expect(own?.members.find((m) => m.id === subId.toString())).toMatchObject({
      receiving: false,
      requested: true,
      effectiveTurn: 41,
    });
    expect(own?.members.find((m) => m.id === rootId.toString())?.receiving).toBeNull();
  });
  it("does not expose private preferences and suggestions to another player", async () => {
    await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
      action: "participation",
      enabled: true,
    });
    const view = await groupManagementView(db, await doc(subId), outsider.toString());
    expect(view?.canManage).toBe(false);
    expect(view?.members.every((m) => m.receiving === null && m.direction === null)).toBe(true);
  });
  it("retains consent but refuses changes under commercial independence", async () => {
    await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
      action: "participation",
      enabled: true,
    });
    await updateGroupManagement(db, await doc(rootId), parentUser.toString(), {
      action: "policy",
      policy: "independent",
    });
    expect(
      await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
        action: "participation",
        enabled: false,
      })
    ).toMatchObject({ ok: false, status: 409 });
    expect((await doc(subId)).groupReceiving?.enabled).toBe(true);
  });
  it("invalidates settings access when the group dissolves", async () => {
    await memory
      .collection("corporations")
      .updateOne({ _id: subId }, { $set: { shareholders: [] } });
    expect(await groupManagementView(db, await doc(subId), playerUser.toString())).toBeNull();
    expect(
      await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
        action: "participation",
        enabled: true,
      })
    ).toMatchObject({ ok: false, status: 409 });
  });
  it("saves a suggestion and only its receiving CEO can answer", async () => {
    expect(
      await updateGroupManagement(db, await doc(rootId), parentUser.toString(), {
        action: "direction",
        memberId: subId.toString(),
        objective: "regional",
        regions: ["US-PA"],
        allowInvestment: true,
      })
    ).toEqual({ ok: true });
    expect(
      await updateGroupManagement(db, await doc(subId), parentUser.toString(), {
        action: "respond",
        response: "acknowledged",
        revision: (await doc(subId)).groupDirection!.revision,
      })
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
        action: "respond",
        response: "declined",
        revision: (await doc(subId)).groupDirection!.revision,
      })
    ).toEqual({ ok: true });
    expect((await doc(subId)).groupDirection?.response).toBe("declined");
  });
  it("fails closed when subsidiary management is disabled", async () => {
    await memory
      .collection("gameState")
      .updateOne({ _id: "current" }, { $set: { subsidiaryCorporationsEnabled: false } });
    expect(
      await updateGroupManagement(db, await doc(rootId), parentUser.toString(), {
        action: "identity",
        name: "Hidden",
      })
    ).toMatchObject({ ok: false, status: 409 });
  });
});

describe("private participation-sensitive forecasts", () => {
  async function seedForecast() {
    const f = coordinationFixture();
    const ids = new Map([
      ["s", rootId.toString()],
      ["b", subId.toString()],
    ]);
    await memory.collection("corporations").updateOne(
      { _id: rootId },
      {
        $set: {
          groupSupplyBasis: {
            turn: 40,
            rootId: rootId.toString(),
            memberIds: [rootId.toString(), subId.toString()],
            cashByMember: { [rootId.toString()]: 1000, [subId.toString()]: 1000 },
            complete: true,
            books: [
              {
                ...f,
                sellers: f.sellers.map((s) => ({
                  ...s,
                  memberId: ids.get(s.memberId),
                  openFill: 0.5,
                  quoteFactor: 1,
                })),
                buyers: f.buyers.slice(0, 1).map((b) => ({ ...b, memberId: ids.get(b.memberId) })),
              },
            ],
          },
        },
      }
    );
    // The parent in this API fixture is player operated, so automatic supplying stays zero.
    memory.seed("gameConfig", [
      { _id: "default", marketSystemMode: "plants", groupSupplyCoordinationEnabled: true },
    ]);
  }
  it("never exposes another corporation's forecast rows, aggregate or raw inputs", async () => {
    await seedForecast();
    const owner = await groupManagementView(db, await doc(rootId), parentUser.toString());
    expect(owner?.forecast?.corporations).toHaveLength(2);
    expect(owner?.forecast?.total).not.toBeNull();
    const player = await groupManagementView(db, await doc(subId), playerUser.toString());
    expect(player?.forecast?.total).toBeNull();
    expect(player?.forecast?.connections).toEqual([]);
    expect(player?.forecast?.connectionCount).toBeNull();
    expect(player?.forecast?.corporations.map((r) => r.id)).toEqual([subId.toString()]);
    const other = await groupManagementView(db, await doc(subId), outsider.toString());
    expect(other?.forecast?.corporations).toEqual([]);
    expect(other?.forecast?.connections).toEqual([]);
    expect(other?.forecast?.connectionCount).toBeNull();
    expect(JSON.stringify(other)).not.toContain("cashByMember");
    expect(JSON.stringify(other)).not.toContain("books");
  });
  it("exposes real connection summaries to the parent only", async () => {
    await seedForecast();
    const nppId = new ObjectId();
    memory.seed("corporations", [
      { ...sub, _id: nppId, name: "NPP supplier", ceoType: "npp", userId: undefined },
    ]);
    const f = coordinationFixture();
    await memory.collection("corporations").updateOne(
      { _id: rootId },
      {
        $set: {
          groupSupplyBasis: {
            turn: 40,
            rootId: rootId.toString(),
            memberIds: [rootId.toString(), subId.toString(), nppId.toString()],
            cashByMember: { [subId.toString()]: 1000 },
            complete: true,
            books: [
              {
                ...f,
                sellers: f.sellers.map((r) => ({
                  ...r,
                  memberId: nppId.toString(),
                  openFill: 1,
                  quoteFactor: 1,
                })),
                buyers: f.buyers.slice(0, 1).map((r) => ({ ...r, memberId: subId.toString() })),
              },
            ],
          },
        },
      }
    );
    await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
      action: "participation",
      enabled: true,
    });
    const owner = await groupManagementView(db, await doc(rootId), parentUser.toString());
    expect(owner?.forecast?.connections).toEqual([
      {
        supplierId: nppId.toString(),
        buyerId: subId.toString(),
        commodity: "steel",
        commodityLabel: "Steel & Metals",
        unit: "tons",
        units: 100,
        benchmarkValue: 200,
        rebate: 0,
        estimatedPayment: 200,
      },
    ]);
    expect(owner?.forecast?.connectionCount).toBe(1);
    await updateGroupManagement(db, await doc(rootId), parentUser.toString(), {
      action: "discount",
      discount: 0.35,
    });
    const discounted = await groupManagementView(db, await doc(rootId), parentUser.toString());
    expect(discounted?.forecast?.connections[0]).toMatchObject({
      benchmarkValue: 200,
      rebate: 70,
      estimatedPayment: 130,
    });
    expect(discounted?.forecast?.total?.internalTradingValue).toBe(130);
    const player = await groupManagementView(db, await doc(subId), playerUser.toString());
    expect(player?.forecast?.corporations[0].receivingValue).toBe(130);
    expect(player?.forecast?.connections).toEqual([]);
    expect(player?.forecast?.connectionCount).toBeNull();
    expect(JSON.stringify(player?.forecast)).not.toContain(nppId.toString());
  });
  it("refuses disabled, stale, incomplete or changed-membership forecasts", async () => {
    await seedForecast();
    await memory
      .collection("corporations")
      .updateOne({ _id: rootId }, { $set: { "groupSupplyBasis.turn": 38 } });
    expect(
      (await groupManagementView(db, await doc(rootId), parentUser.toString()))?.forecast
    ).toBeNull();
    await seedForecast();
    await memory
      .collection("corporations")
      .updateOne({ _id: rootId }, { $set: { "groupSupplyBasis.complete": false } });
    expect(
      (await groupManagementView(db, await doc(rootId), parentUser.toString()))?.forecast
    ).toBeNull();
    await seedForecast();
    await memory
      .collection("corporations")
      .updateOne({ _id: rootId }, { $set: { "groupSupplyBasis.memberIds": [rootId.toString()] } });
    expect(
      (await groupManagementView(db, await doc(rootId), parentUser.toString()))?.forecast
    ).toBeNull();
    await seedForecast();
    await memory
      .collection("gameConfig")
      .updateOne({ _id: "default" }, { $set: { groupSupplyCoordinationEnabled: false } });
    expect(
      (await groupManagementView(db, await doc(rootId), parentUser.toString()))?.forecast
    ).toBeNull();
  });
});

describe("inactive corporation management", () => {
  it("rejects a participation write when suspension occurs after the request snapshot", async () => {
    const snapshot = await doc(subId);
    await memory
      .collection("corporations")
      .updateOne({ _id: subId }, { $set: { suspended: true } });
    expect(
      await updateGroupManagement(db, snapshot, playerUser.toString(), {
        action: "participation",
        enabled: true,
      })
    ).toMatchObject({ ok: false, status: 409 });
    expect((await doc(subId)).groupReceiving).toBeUndefined();
  });
  it("keeps suspended CEOs read only and refuses participation updates", async () => {
    await memory
      .collection("corporations")
      .updateOne({ _id: subId }, { $set: { suspended: true } });
    const view = await groupManagementView(db, await doc(subId), playerUser.toString());
    expect(view?.members.find((m) => m.id === subId.toString())?.canEdit).toBe(false);
    expect(
      await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
        action: "participation",
        enabled: true,
      })
    ).toMatchObject({ ok: false, status: 403 });
    await memory
      .collection("corporations")
      .updateOne({ _id: rootId }, { $set: { suspended: true } });
    expect(
      (await groupManagementView(db, await doc(rootId), parentUser.toString()))?.canManage
    ).toBe(false);
  });
});

it("restricts discount edits to the parent CEO and recalculates forecast settings", async () => {
  const command = { action: "discount", discount: 0.35 } as const;
  expect(
    await updateGroupManagement(db, await doc(subId), playerUser.toString(), command)
  ).toMatchObject({ ok: false, status: 403 });
  expect(
    await updateGroupManagement(db, await doc(rootId), parentUser.toString(), command)
  ).toEqual({ ok: true });
  expect((await doc(rootId)).groupManagement?.supplyDiscount).toBe(0.35);
  expect(
    (await groupManagementView(db, await doc(rootId), parentUser.toString()))?.settings
      .supplyDiscount
  ).toBe(0.35);
});

import { BSON, ObjectId, type ClientSession, type Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { openDefaultFederationPoliticalProposal } from "@/lib/world/succession/defaultProposal";
import { recordFederationRatifications } from "@/lib/world/succession/recordRatifications";
import { processRatifiedFederationSettlements } from "./federationSettlements";

vi.mock("@/lib/db/runRequiredTransaction", () => ({ runRequiredTransaction: vi.fn() }));
vi.mock("@/lib/countryAccess", () => ({
  getAllCountryAccess: vi.fn(async () => ({
    CS: { enabledForPlayers: true },
    PL: { enabledForPlayers: true },
  })),
}));
vi.mock("@/lib/currency/gdpAnchorRate", () => ({ loadWorldEraUnitScale: vi.fn(async () => 1) }));

beforeEach(() => vi.clearAllMocks());

async function scenario() {
  const mem = createInMemoryDb();
  mem.seed("gameState", [
    { _id: "current", preset: "1991-default", currentYear: 1992, currentTurn: 180 },
  ]);
  mem.seed("countryGameStates", [{ _id: "CS", dissolvedTurn: null }]);
  mem.seed("states", [
    ...["CS_PRG", "CS_BOH", "CS_MOR", "CS_SVK"].map((_id) => ({
      _id,
      countryId: "CS",
      population: 10,
      gdp: 100,
    })),
    { _id: "MAZ", countryId: "PL", population: 10, gdp: 100 },
  ]);
  mem.seed("federalBudget", [
    { _id: "CS", countryId: "CS", treasuryBalance: 40, debt: { principal: 0 } },
  ]);
  const characterId = new ObjectId("000000000000000000000201");
  mem.seed("characters", [{ _id: characterId, countryId: "CS", homeState: "CS_SVK", cash: 50 }]);
  let active = false;
  let failReceipt = false;
  const session = { inTransaction: () => active } as ClientSession;
  const methods = new Set([
    "find",
    "findOne",
    "insertOne",
    "insertMany",
    "updateOne",
    "updateMany",
    "deleteOne",
    "deleteMany",
    "bulkWrite",
  ]);
  const db = new Proxy(mem, {
    get(target, key) {
      if (key !== "collection") return Reflect.get(target, key);
      return (name: string) =>
        new Proxy(target.collection(name), {
          get(collection, method) {
            const value = Reflect.get(collection, method);
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => {
              if (active && methods.has(String(method))) {
                expect(args.at(-1)).toMatchObject({ session });
              }
              if (
                active &&
                failReceipt &&
                name === "federationSettlementApplications" &&
                method === "insertOne"
              )
                throw new Error("injected receipt failure");
              return value.apply(collection, args);
            };
          },
        });
    },
  }) as unknown as Db;
  vi.mocked(runRequiredTransaction).mockImplementation(async (body) => {
    const snapshot = new Map(
      [...mem.collections].map(([name, collection]) => [
        name,
        BSON.EJSON.stringify(collection.docs),
      ])
    );
    active = true;
    try {
      return await body(session);
    } catch (error) {
      for (const [name, collection] of mem.collections) {
        collection.docs = snapshot.has(name) ? BSON.EJSON.parse(snapshot.get(name)!) : [];
      }
      throw error;
    } finally {
      active = false;
    }
  });
  const proposal = await openDefaultFederationPoliticalProposal({
    db,
    sourceCountryId: "CS",
    currentYear: 1992,
    now: new Date(0),
  });
  await db
    .collection("bills")
    .updateOne({ _id: proposal.billId }, { $set: { status: "signed", enactedAt: new Date(1) } });
  await recordFederationRatifications({
    db,
    sourceCountryId: "CS",
    settlementId: proposal.settlementId,
    revision: proposal.revision,
    currentTurn: 181,
  });
  return {
    db,
    characterId,
    setReceiptFailure: (value: boolean) => {
      failReceipt = value;
    },
  };
}

describe("ratified federation turn application", () => {
  it("applies the live settlement once and preserves an affected resident pending choice", async () => {
    const { db, characterId } = await scenario();
    expect(
      await processRatifiedFederationSettlements(db, "1991-default", 181, 1992, new Date(2))
    ).toBe(1);
    expect(
      await processRatifiedFederationSettlements(db, "1991-default", 182, 1992, new Date(3))
    ).toBe(0);
    expect(runRequiredTransaction).toHaveBeenCalledTimes(1);
    expect(await db.collection("characters").findOne({ _id: characterId })).toMatchObject({
      cash: 50,
      homeState: "CS_SVK",
      federationPendingResidenceId: "1991-default:cs-1991-default:1",
    });
    expect(await db.collection("states").countDocuments({ countryId: "CS" })).toBe(0);
    expect(await db.collection("macroCountries").countDocuments({})).toBe(2);
    expect(await db.collection("federationFiscalAccounts").countDocuments({})).toBe(3);
  });

  it("leaves no frozen preparation after a failed transaction and retries at the later turn", async () => {
    const { db, setReceiptFailure } = await scenario();
    setReceiptFailure(true);
    await expect(
      processRatifiedFederationSettlements(db, "1991-default", 181, 1992, new Date(2))
    ).rejects.toThrow("injected receipt failure");
    expect(await db.collection("federationSettlementIntents").countDocuments({})).toBe(0);
    expect(await db.collection("federationPublicationPreparations").countDocuments({})).toBe(0);
    expect(await db.collection("states").countDocuments({ countryId: "CS" })).toBe(4);
    setReceiptFailure(false);
    expect(
      await processRatifiedFederationSettlements(db, "1991-default", 182, 1992, new Date(3))
    ).toBe(1);
    expect(
      await db.collection("federationSettlementApplications").findOne({ sourceEntityId: "CS" })
    ).toMatchObject({ appliedOnTurn: 182 });
  });

  it("keeps a rejected participant's settlement inactive", async () => {
    const { db } = await scenario();
    await db
      .collection("federationRatifications")
      .updateOne({ entityId: "SK" }, { $set: { choice: "reject" } });
    expect(
      await processRatifiedFederationSettlements(db, "1991-default", 181, 1992, new Date(2))
    ).toBe(0);
    expect(runRequiredTransaction).not.toHaveBeenCalled();
    expect(await db.collection("states").countDocuments({ countryId: "CS" })).toBe(4);
  });
});

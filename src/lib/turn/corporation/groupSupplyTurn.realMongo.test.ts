import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BSON, MongoClient, ObjectId, type Document } from "mongodb";
import {
  REAL_MONGO_ENABLED,
  startIsolatedMongod,
  stopIsolatedMongod,
  assertOwnedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import { buildMarketContext } from "@/lib/market/marketContext";
import { configureGroupSupply, groupForecastWriteOps } from "./groupSupplyTurn";
import type { CorporationLookups } from "./types";
import type { Corporation } from "@/lib/db/types";
describe.skipIf(!REAL_MONGO_ENABLED)("isolated group turn ownership and persistence", () => {
  let fixture: IsolatedMongod, client: MongoClient;
  const root = new ObjectId(),
    child = new ObjectId();
  let commands: string[] = [],
    replyBytes = 0;
  beforeAll(async () => {
    fixture = await startIsolatedMongod("ahd-group-supply-");
    client = new MongoClient(fixture.uri, { monitorCommands: true });
    await client.connect();
    await assertOwnedMongod(fixture.proc, client);
    await client
      .db(fixture.dbName)
      .collection("corporations")
      .insertMany([
        { _id: root, ceoId: new ObjectId(), totalShares: 100, shareholders: [] },
        {
          _id: child,
          ceoId: new ObjectId(),
          subsidiaryFormalizedAtTurn: 1,
          totalShares: 100,
          shareholders: [],
        },
      ]);
    // The controlling block is temporarily reserved by an open corporate sale.
    await client.db(fixture.dbName).collection("shareOrders").insertOne({
      corporationId: child,
      placerCorporationId: root,
      type: "sell",
      status: "open",
      sharesRemaining: 75,
    });
    client.on("commandStarted", (event) => commands.push(event.commandName));
    client.on("commandSucceeded", (event) => {
      replyBytes += BSON.calculateObjectSize(event.reply as Document);
    });
  }, 60000);
  afterAll(async () => {
    await client?.close();
    await stopIsolatedMongod(fixture);
  });
  it("uses one bounded ownership snapshot and an existing bulk write, with no disabled-world I/O", async () => {
    const db = client.db(fixture.dbName);
    const market = buildMarketContext("plants");
    commands = [];
    replyBytes = 0;
    expect(await configureGroupSupply(db, market, true, false)).toBeUndefined();
    expect(commands).toEqual([]);
    expect(replyBytes).toBe(0);
    const groups = await configureGroupSupply(db, market, true, true);
    expect(groups?.membersByRootId.get(root.toString())).toHaveLength(2);
    expect(groups?.eligibleManagementRoots?.has(root.toString())).toBe(true);
    expect(commands).toEqual(["find", "find", "find"]);
    const readBytes = replyBytes;
    const basis = {
      turn: 20,
      rootId: root.toString(),
      memberIds: [root.toString(), child.toString()],
      cashByMember: {},
      books: [],
      complete: true,
    };
    market.groupSupplyForecastByRoot = new Map([[root.toString(), basis]]);
    const lookups = {
      corpById: new Map([[root.toString(), { _id: root } as Corporation]]),
    } as CorporationLookups;
    const ops = groupForecastWriteOps(market, lookups);
    expect(ops).toHaveLength(1);
    await db.collection<Corporation>("corporations").bulkWrite(ops);
    expect((await db.collection("corporations").findOne({ _id: root }))?.groupSupplyBasis).toEqual(
      basis
    );
    process.stdout.write(
      JSON.stringify({
        qualification: "group ownership fixture",
        disabled: { commands: 0, replyBytes: 0 },
        enabled: {
          ownershipCommands: 3,
          ownershipReplyBytes: readBytes,
          forecastBsonBytes: BSON.calculateObjectSize(basis),
          appendedBulkOperations: ops.length,
        },
      }) + "\n"
    );
  });
});

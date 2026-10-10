import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";
import { listAdvertisingSuppliers } from "./suppliers";

const buyerId = new ObjectId();
const supplierId = new ObjectId();

function supplierDb(): Db {
  const group = {
    _id: supplierId,
    sectors: 7,
    states: ["US-CA", "US-NY"],
    strategies: [
      undefined,
      null,
      "",
      "standard",
      "legacy_broadcast",
      "broadcast_tv",
      "streaming_platform",
    ],
  };
  const supplier = { _id: supplierId, name: "Publisher" };

  return {
    collection: (name: string) => {
      if (name === "corporateSectors") {
        return { aggregate: () => ({ toArray: async () => [group] }) };
      }
      if (name === "corporations") {
        return {
          find: () => ({ project: () => ({ toArray: async () => [supplier] }) }),
        };
      }
      if (name === "exchangeRates") {
        return { find: () => ({ toArray: async () => [] }) };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
  } as unknown as Db;
}

const buyer = { _id: buyerId } as unknown as Corporation;

beforeEach(() => resetCorpFxRateCacheForTests());

describe("listAdvertisingSuppliers", () => {
  it("lists implicit newspaper suppliers and resolves legacy broadcast at the world year", async () => {
    const beforeTelevision = await listAdvertisingSuppliers(supplierDb(), buyer, 1949);
    expect(beforeTelevision.suppliers).toMatchObject([
      {
        name: "Publisher",
        mediaSectorCount: 7,
        stateCount: 2,
        models: ["Newspaper", "Radio Network"],
      },
    ]);

    resetCorpFxRateCacheForTests();
    const fromTelevisionYear = await listAdvertisingSuppliers(supplierDb(), buyer, 1950);
    expect(fromTelevisionYear.suppliers).toMatchObject([
      {
        name: "Publisher",
        mediaSectorCount: 7,
        stateCount: 2,
        models: ["Newspaper", "Broadcast Television"],
      },
    ]);
  });
});

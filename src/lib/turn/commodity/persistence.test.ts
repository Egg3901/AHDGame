import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { CommodityType } from "@/lib/constants/commodities";
import {
  buildCorporationCommodityOutputOps,
  serializeCorporationCommodityOutput,
} from "./persistence";

describe("serializeCorporationCommodityOutput", () => {
  it("rounds realized ledger units and omits invalid or empty contributions", () => {
    const supply = new Map<CommodityType, number>([
      ["coal", 2_646_929.126],
      ["chemicals", 0],
      ["plastics", Number.NaN],
      ["steel", -4],
    ]);

    expect(serializeCorporationCommodityOutput(supply)).toEqual({ coal: 2_646_929.13 });
    expect(serializeCorporationCommodityOutput(undefined)).toEqual({});
  });

  it("builds one current-turn correction per corporation and clears non-producers", () => {
    const producer = new ObjectId();
    const nonProducer = new ObjectId();
    const ops = buildCorporationCommodityOutputOps(
      [producer, nonProducer],
      new Map([[producer.toString(), new Map<CommodityType, number>([["coal", 12.345]])]]),
      1214
    );

    expect(ops).toEqual([
      {
        updateMany: {
          filter: { corporationId: producer, turn: 1214 },
          update: {
            $set: { commodityOutput: { coal: 12.35 }, commodityOutputBasis: "plants-ledger-v1" },
          },
        },
      },
      {
        updateMany: {
          filter: { corporationId: nonProducer, turn: 1214 },
          update: {
            $set: { commodityOutput: {}, commodityOutputBasis: "plants-ledger-v1" },
          },
        },
      },
    ]);
  });
});

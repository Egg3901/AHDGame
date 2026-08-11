import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  bucketKey,
  computeCapturedMarketMergeBuckets,
  computeNatCorpSoleOwnerBuckets,
  computeSeedProtectedBuckets,
  computeStateControlledBuckets,
} from "./stateControlledBuckets";
import { sectorTakingKey } from "./enactedSectorTaking";

const NAT = new ObjectId();
const PRIV = new ObjectId();
const CN = "CN";

function sector(
  corporationId: ObjectId,
  stateId: string,
  sectorType: string,
  revenue: number,
  nationalizedAtTurn?: number,
  countryId: string = CN
) {
  return { corporationId, stateId, sectorType, revenue, nationalizedAtTurn, countryId } as never;
}

describe("computeStateControlledBuckets", () => {
  const natIds = new Set([NAT.toString()]);

  it("marks a nationalized bucket the national corp solely holds as controlled", () => {
    const set = computeStateControlledBuckets(
      [sector(NAT, "HD", "telecommunications", 1000, 331)],
      natIds
    );
    expect(set.has(bucketKey("HD", "telecommunications"))).toBe(true);
  });

  it("marks a nationalized bucket where the national corp holds the revenue majority as controlled", () => {
    const set = computeStateControlledBuckets(
      [
        sector(NAT, "HD", "telecommunications", 4_800_000, 331),
        sector(PRIV, "HD", "telecommunications", 757),
        sector(PRIV, "HD", "telecommunications", 712),
      ],
      natIds
    );
    expect(set.has(bucketKey("HD", "telecommunications"))).toBe(true);
  });

  it("does NOT mark a bucket where private holders out-revenue the national corp", () => {
    const set = computeStateControlledBuckets(
      [sector(NAT, "HD", "energy", 400, 331), sector(PRIV, "HD", "energy", 1000)],
      natIds
    );
    expect(set.has(bucketKey("HD", "energy"))).toBe(false);
  });

  it("does NOT mark a seeded state monopoly (no nationalizedAtTurn) — only bill-nationalized buckets", () => {
    // e.g. the NHS: state holds the majority but it wasn't taken by a bill, so its
    // private market must keep growing — not frozen.
    const set = computeStateControlledBuckets(
      [sector(NAT, "ENG", "healthcare", 9_000_000), sector(PRIV, "ENG", "healthcare", 1_000_000)],
      natIds
    );
    expect(set.has(bucketKey("ENG", "healthcare"))).toBe(false);
  });

  it("ignores buckets with no national-corp presence", () => {
    const set = computeStateControlledBuckets([sector(PRIV, "HD", "retail", 5000)], natIds);
    expect(set.size).toBe(0);
  });
});

describe("computeNatCorpSoleOwnerBuckets", () => {
  const natIds = new Set([NAT.toString()]);

  it("marks a bucket where only the national corp holds corporate sectors", () => {
    const set = computeNatCorpSoleOwnerBuckets([sector(NAT, "BJ", "energy", 5_000_000)], natIds);
    expect(set.has(bucketKey("BJ", "energy"))).toBe(true);
  });

  it("does NOT mark a bucket with private competitors (e.g. NHS + private healthcare)", () => {
    const set = computeNatCorpSoleOwnerBuckets(
      [sector(NAT, "ENG", "healthcare", 9_000_000), sector(PRIV, "ENG", "healthcare", 1_000_000)],
      natIds
    );
    expect(set.has(bucketKey("ENG", "healthcare"))).toBe(false);
  });
});

describe("computeSeedProtectedBuckets", () => {
  const natIds = new Set([NAT.toString()]);

  it("includes bill-nationalized and sole-owner captures", () => {
    const set = computeSeedProtectedBuckets(
      [
        sector(NAT, "HD", "telecommunications", 1000, 331),
        sector(NAT, "BJ", "energy", 5_000_000),
        sector(NAT, "ENG", "healthcare", 9_000_000),
        sector(PRIV, "ENG", "healthcare", 1_000_000),
      ],
      natIds
    );
    expect(set.has(bucketKey("HD", "telecommunications"))).toBe(true);
    expect(set.has(bucketKey("BJ", "energy"))).toBe(true);
    expect(set.has(bucketKey("ENG", "healthcare"))).toBe(false);
  });
});

describe("computeCapturedMarketMergeBuckets", () => {
  const natIds = new Set([NAT.toString()]);
  const fullTake = new Map([
    [sectorTakingKey(CN, "telecommunications"), { scope: "all" as const, carveFraction: 1 }],
    [sectorTakingKey(CN, "energy"), { scope: "all" as const, carveFraction: 1 }],
  ]);

  it("includes state-controlled buckets with private split intruders", () => {
    const set = computeCapturedMarketMergeBuckets(
      [
        sector(NAT, "HD", "telecommunications", 4_800_000, 331),
        sector(PRIV, "HD", "telecommunications", 757),
      ],
      natIds,
      fullTake
    );
    expect(set.has(bucketKey("HD", "telecommunications"))).toBe(true);
  });

  it("includes nationalized buckets even when private splits flipped the majority (full corp-taking law)", () => {
    const set = computeCapturedMarketMergeBuckets(
      [sector(NAT, "HD", "energy", 400, 331), sector(PRIV, "HD", "energy", 1000)],
      natIds,
      fullTake
    );
    expect(set.has(bucketKey("HD", "energy"))).toBe(true);
  });

  it("does NOT merge private corps when enacted law was unowned-only", () => {
    const unownedOnly = new Map([
      [sectorTakingKey(CN, "energy"), { scope: "unowned" as const, carveFraction: 1 }],
    ]);
    const set = computeCapturedMarketMergeBuckets(
      [sector(NAT, "HD", "energy", 400, 331), sector(PRIV, "HD", "energy", 1000)],
      natIds,
      unownedOnly
    );
    expect(set.has(bucketKey("HD", "energy"))).toBe(false);
  });

  it("does NOT merge private corps on partial carve even when nat corp holds majority", () => {
    const partial = new Map([
      [sectorTakingKey(CN, "telecommunications"), { scope: "all" as const, carveFraction: 0.5 }],
    ]);
    const set = computeCapturedMarketMergeBuckets(
      [
        sector(NAT, "HD", "telecommunications", 4_800_000, 331),
        sector(PRIV, "HD", "telecommunications", 757),
      ],
      natIds,
      partial
    );
    expect(set.has(bucketKey("HD", "telecommunications"))).toBe(false);
  });

  it("does NOT include seeded monopolies without nationalization stamps", () => {
    const set = computeCapturedMarketMergeBuckets(
      [sector(NAT, "ENG", "healthcare", 9_000_000), sector(PRIV, "ENG", "healthcare", 1_000_000)],
      natIds,
      fullTake
    );
    expect(set.has(bucketKey("ENG", "healthcare"))).toBe(false);
  });
});

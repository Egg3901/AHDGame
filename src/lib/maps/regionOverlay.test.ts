import { describe, it, expect } from "vitest";
import {
  computeRegionBlobs,
  selectStructuralOverlayShards,
  type RegionOverlayShard,
} from "./regionOverlay";
import { RU_REGION_CODES, RU_LABEL_OVERRIDES } from "./ruGeometry";
import { REGION_SHARDS } from "./regionManifest";

const sq = (n: number) => ({
  type: "Polygon",
  coordinates: [
    [
      [n, 0],
      [n + 1, 0],
      [n + 1, 1],
      [n, 1],
      [n, 0],
    ],
  ],
});
const feat = (code: string, n: number) => ({ properties: { regionCode: code }, geometry: sq(n) });
// Trivial union: each input polygon becomes its own output polygon (keys/shape is
// what the helper logic decides; the real polygon-clipping is exercised live).
const mockPC = {
  union: (p: number[][][], ...rest: number[][][][]) => [p, ...rest] as number[][][][],
};
const shard = (baseCountryIds: string[], feats: ReturnType<typeof feat>[]): RegionOverlayShard => ({
  baseCountryIds,
  features: feats,
});

describe("computeRegionBlobs", () => {
  it("unions a SPLIT shard's regions per owner and marks its base covered", () => {
    const { blobs, coveredBases } = computeRegionBlobs(
      [shard(["DE"], [feat("BW", 0), feat("BB", 2), feat("BY", 4)])],
      { BW: "FR", BB: "DD", BY: "DE" },
      {},
      mockPC
    );
    expect([...blobs.keys()].sort()).toEqual(["DD", "DE", "FR"]);
    expect(coveredBases.has("DE")).toBe(true);
  });

  it("skips a single-owner (unified) shard by default", () => {
    const { blobs, coveredBases } = computeRegionBlobs(
      [shard(["BR"], [feat("NORTE", 0), feat("SUL", 2)])],
      { NORTE: "BR", SUL: "BR" },
      {},
      mockPC
    );
    expect(blobs.size).toBe(0);
    expect(coveredBases.size).toBe(0);
  });

  it("unions a single-owner shard when includeSingleOwner is true", () => {
    const { blobs, coveredBases } = computeRegionBlobs(
      [shard(["BR"], [feat("NORTE", 0), feat("SUL", 2)])],
      { NORTE: "BR", SUL: "BR" },
      {},
      mockPC,
      true
    );
    expect([...blobs.keys()]).toEqual(["BR"]); // one merged blob for the unified nation
    expect(coveredBases.has("BR")).toBe(true);
  });

  it("structural mode keeps multi-base single-owner silhouettes, skips homeland detail", () => {
    const ussr = shard(["RU", "398", "498"], [feat("NWR", 0), feat("CAS", 2)]);
    const brazil = shard(["BR"], [feat("NORTE", 4), feat("SUL", 6)]);
    const { blobs, coveredBases } = computeRegionBlobs(
      [ussr, brazil],
      { NWR: "RU", CAS: "RU", NORTE: "BR", SUL: "BR" },
      {},
      mockPC,
      "structural"
    );
    expect([...blobs.keys()]).toEqual(["RU"]);
    expect(coveredBases.has("RU")).toBe(true);
    expect(coveredBases.has("398")).toBe(true);
    expect(coveredBases.has("BR")).toBe(false);
  });

  it("selectStructuralOverlayShards skips unified homeland downloads", () => {
    const ussr = {
      area: "soviet-union",
      baseCountryIds: ["RU", "398"],
      codes: ["NWR", "CAS"],
    };
    const germany = { area: "germany", baseCountryIds: ["DE"], codes: ["BW", "BB"] };
    const usa = { area: "usa", baseCountryIds: ["US"], codes: ["CA", "NY"] };
    const picked = selectStructuralOverlayShards([ussr, germany, usa], {
      NWR: "RU",
      CAS: "RU",
      BW: "DE",
      BB: "DD",
      CA: "US",
      NY: "US",
    });
    expect(picked.map((s) => s.area).sort()).toEqual(["germany", "soviet-union"]);
  });

  it("skips a partially-owned shard", () => {
    const { blobs } = computeRegionBlobs(
      [shard(["DE"], [feat("BW", 0), feat("BB", 2)])],
      { BW: "DE" }, // BB unowned
      {},
      mockPC
    );
    expect(blobs.size).toBe(0);
  });

  it("applies the fold (West Berlin follows Brandenburg's owner)", () => {
    const { blobs } = computeRegionBlobs(
      [shard(["DE"], [feat("BE", 0), feat("BB", 2), feat("BW", 4)])],
      { BE: "FR", BB: "DD", BW: "DE" },
      { BE: "BB" }, // BE → BB's owner (DD), so no FR blob from BE
      mockPC
    );
    expect([...blobs.keys()].sort()).toEqual(["DD", "DE"]);
  });

  it("fuses an acquirer's homeland only when geometry is supplied", () => {
    const { coveredBases } = computeRegionBlobs(
      [shard(["DE"], [feat("BW", 0), feat("BB", 2)])],
      { BW: "FR", BB: "DD" },
      {},
      mockPC,
      false,
      (owner) => (owner === "FR" ? sq(10) : undefined)
    );
    expect(coveredBases.has("FR")).toBe(true); // FR homeland fused → its base hidden
    expect(coveredBases.has("DD")).toBe(false); // no homeland geometry → not fused
  });
});

describe("Soviet shard no longer covers Ukraine, Belarus or the Baltics", () => {
  it("carries only the 14 remaining RU region codes", () => {
    expect(RU_REGION_CODES).toHaveLength(14);
    for (const gone of ["UKR", "BEL", "BLT"]) {
      expect(RU_REGION_CODES).not.toContain(gone);
    }
  });

  it("leaves those base features to the new countries' own shards", () => {
    const su = REGION_SHARDS.find((s) => s.area === "soviet-union");
    expect(su).toBeDefined();
    // 804 Ukraine, 112 Belarus, 233 Estonia, 428 Latvia, 440 Lithuania. They
    // must be hidden by exactly one shard: whichever shard hides them owns the
    // territory, and two claims would fight over the same base polygon.
    for (const id of ["804", "112", "233", "428", "440"]) {
      expect(su!.baseCountryIds).not.toContain(id);
      const owners = REGION_SHARDS.filter((s) => s.baseCountryIds.includes(id));
      expect(owners.map((s) => s.area)).toHaveLength(1);
    }
  });

  it("labels every region code", () => {
    for (const code of RU_REGION_CODES) {
      expect(RU_LABEL_OVERRIDES[code], `missing label for ${code}`).toBeTruthy();
    }
  });
});

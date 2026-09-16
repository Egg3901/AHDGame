import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { PrivateEnterpriseBlockedError } from "@/lib/economy/queries/privateEnterpriseGate";
import { stubMarketizationDb as stubDb } from "@/lib/test-utils/stubMarketizationDb";
import { privatizeAsset } from "./privatizeAsset";

/**
 * `privatizeAsset` has four callers - the executive privatize route, the
 * legislative provision (`legislativePrivatize`), the court-ordered reversal
 * fallback (`reverseNationalization`), and the auction path. The gate lives in
 * the engine so all four are covered at once; gating only the route is what
 * left this open after #676.
 *
 * `stubMarketizationDb` serves the gate's two reads and THROWS on any other collection, so
 * these tests also prove the guard runs before `privatizeAsset` touches
 * `corporations` or `corporateSectors`.
 */
describe("privatizeAsset command-economy gate", () => {
  const baseParams = {
    sourceNationalCorporationId: new ObjectId(),
    selections: [{ sectorId: new ObjectId(), carveFraction: 1 }],
    newCorpName: "Test Spin Out",
    goldenSharePercent: 0,
    turn: 900,
  };

  it("refuses an auction spin-out in a command economy", async () => {
    await expect(
      privatizeAsset(stubDb({ currentYear: 1970 }), {
        ...baseParams,
        countryId: "RU",
        method: "auction",
      })
    ).rejects.toBeInstanceOf(PrivateEnterpriseBlockedError);
  });

  it("refuses an IPO spin-out in a command economy", async () => {
    await expect(
      privatizeAsset(stubDb({ currentYear: 1970 }), {
        ...baseParams,
        countryId: "RU",
        method: "ipo",
      })
    ).rejects.toBeInstanceOf(PrivateEnterpriseBlockedError);
  });

  it("refuses in China, which is dial-governed and carries no config flag", async () => {
    await expect(
      privatizeAsset(stubDb({ currentYear: 1970 }), {
        ...baseParams,
        countryId: "CN",
        method: "auction",
      })
    ).rejects.toBeInstanceOf(PrivateEnterpriseBlockedError);
  });

  it("refuses in a union republic, which carried no config flag either", async () => {
    await expect(
      privatizeAsset(stubDb({ currentYear: 1970 }), {
        ...baseParams,
        countryId: "UKR",
        method: "ipo",
      })
    ).rejects.toBeInstanceOf(PrivateEnterpriseBlockedError);
  });

  it("does NOT refuse a market economy - it proceeds past the gate", async () => {
    // stubDb throws on any collection other than the gate's two, so reaching a
    // different error proves the gate permitted US and execution continued.
    await expect(
      privatizeAsset(stubDb({ currentYear: 1970 }), {
        ...baseParams,
        countryId: "US",
        method: "ipo",
      })
    ).rejects.not.toBeInstanceOf(PrivateEnterpriseBlockedError);
  });

  it("releases a command economy once its dial crosses the ceiling", async () => {
    await expect(
      privatizeAsset(stubDb({ currentYear: 1970, levels: { RU: 55 } }), {
        ...baseParams,
        countryId: "RU",
        method: "ipo",
      })
    ).rejects.not.toBeInstanceOf(PrivateEnterpriseBlockedError);
  });
});

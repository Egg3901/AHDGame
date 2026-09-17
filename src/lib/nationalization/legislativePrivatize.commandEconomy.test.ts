/**
 * REGRESSION: the LEGISLATIVE spin-out route into a command economy.
 *
 * This is the route that actually produced every private corporation in the live
 * USSR. All three came from bills, not from the executive treasury action:
 *
 *   "Market Liberalism I"          method ipo                -> seq 629
 *   "Market Liberalism II"         method auction, res 150000 -> Gastronom (734)
 *   "Induction of Soyuzpromresurs" method auction, res  10000 -> Soyuzpromresurs (863)
 *
 * The owner's own account matches: "the premier went ahead and privatised a very
 * small part of the energy sector as a reward... Passed a legislation to spin out
 * the corp." The token 10,000 reserve was written into the bill text.
 *
 * This is why the gate lives inside `privatizeAsset` rather than on the executive
 * route. #676 gated the route; had this fix done the same, none of these three
 * would have been stopped.
 *
 * Two independent guards are asserted here:
 *   1. The provision is refused while the bill is being WRITTEN
 *      (`validateNationalizationProvisions`), so it never reaches a vote.
 *   2. The engine refuses at ENACTMENT, which is what protects a bill that was
 *      already in flight when the fix shipped.
 */
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { stubMarketizationDb } from "@/lib/test-utils/stubMarketizationDb";
import { PrivateEnterpriseBlockedError } from "@/lib/economy/queries/privateEnterpriseGate";
import { privatizeAsset } from "./privatizeAsset";

const SOURCE_NATCORP = new ObjectId();

/** The provision as the live "Induction of Soyuzpromresurs" bill carried it. */
const soyuzpromresursProvision = {
  type: "privatize" as const,
  sourceNationalCorporationId: SOURCE_NATCORP.toHexString(),
  selections: [{ sectorId: new ObjectId().toHexString(), carveFraction: 1 }],
  newCorpName: "Soyuzpromresurs",
  goldenSharePercent: 0,
  method: "auction" as const,
  reservePrice: 10_000,
};

describe("legislative spin-out into a command economy", () => {
  it("is refused while the bill is being written", async () => {
    const db = stubMarketizationDb({
      currentYear: 1970,
      base: createMockDb() as unknown as Db,
    });
    const { validateNationalizationProvisions } = await import("./billProvisionValidation");

    const res = await validateNationalizationProvisions(db, [soyuzpromresursProvision], "RU");

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
      expect(res.error).toContain("command economy");
    }
  });

  it("is refused at ENACTMENT too, which covers a bill already in flight", async () => {
    // stubMarketizationDb throws on any collection but the gate's two, so
    // reaching a PrivateEnterpriseBlockedError proves the engine refused before
    // it read the source National Corporation.
    await expect(
      privatizeAsset(stubMarketizationDb({ currentYear: 1970 }), {
        countryId: "RU",
        sourceNationalCorporationId: SOURCE_NATCORP,
        selections: [{ sectorId: new ObjectId(), carveFraction: 1 }],
        newCorpName: "Soyuzpromresurs",
        goldenSharePercent: 0,
        method: "auction",
        reservePrice: 10_000,
        turn: 900,
      })
    ).rejects.toBeInstanceOf(PrivateEnterpriseBlockedError);
  });

  it("refuses the IPO variant the other two bills used", async () => {
    await expect(
      privatizeAsset(stubMarketizationDb({ currentYear: 1970 }), {
        countryId: "RU",
        sourceNationalCorporationId: SOURCE_NATCORP,
        selections: [{ sectorId: new ObjectId(), carveFraction: 1 }],
        newCorpName: "Glavnoye Upravleniye Zhylishchnogo Fonda",
        goldenSharePercent: 0,
        method: "ipo",
        turn: 900,
      })
    ).rejects.toBeInstanceOf(PrivateEnterpriseBlockedError);
  });

  it("a passed bill cannot abort enactment: the provision handler swallows the refusal", async () => {
    // `applyPrivatizeProvision` catches engine errors by design so one bad
    // provision cannot wreck the rest of a bill. Confirm the refusal is
    // contained rather than thrown into the enactment loop.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = stubMarketizationDb({
      currentYear: 1970,
      base: createMockDb() as unknown as Db,
    });
    const { applyPrivatizeProvision } = await import("./legislativePrivatize");

    await expect(
      applyPrivatizeProvision(db, "RU", {
        ...soyuzpromresursProvision,
        sourceNationalCorporationId: SOURCE_NATCORP,
        selections: [{ sectorId: new ObjectId(), carveFraction: 1 }],
      } as never)
    ).resolves.toBeUndefined();

    consoleError.mockRestore();
  });

  it("still permits a legislative spin-out in a market economy", async () => {
    // Guards against fixing the leak by disabling the mechanic everywhere.
    await expect(
      privatizeAsset(stubMarketizationDb({ currentYear: 1970 }), {
        countryId: "US",
        sourceNationalCorporationId: SOURCE_NATCORP,
        selections: [{ sectorId: new ObjectId(), carveFraction: 1 }],
        newCorpName: "Some American Spin Out",
        goldenSharePercent: 0,
        method: "ipo",
        turn: 900,
      })
    ).rejects.not.toBeInstanceOf(PrivateEnterpriseBlockedError);
  });
});

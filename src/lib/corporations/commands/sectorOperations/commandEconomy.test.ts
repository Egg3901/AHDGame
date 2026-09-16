/**
 * REGRESSION: the secondary sector market must not route around the
 * command-economy gate.
 *
 * `#676` gated `expandSector` (founding a NEW sector in a market) and left
 * `buyListedSector` untouched, so a private corp could still acquire production
 * inside a planned economy by buying a listing. `listSectorForSale` had no
 * state-owned guard at all, so an SOE with a seated CEO could put planned
 * production on the open market and bypass privatization entirely.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { stubMarketizationDb } from "@/lib/test-utils/stubMarketizationDb";
import { isPrivateEnterpriseBlocked } from "@/lib/economy/queries/privateEnterpriseGate";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import type { Corporation } from "@/lib/db/types";

describe("secondary sector market - command economy", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("buyListedSector gate keys on the SECTOR's country", () => {
    it("blocks a purchase of production sited inside a command economy", async () => {
      const db = stubMarketizationDb({ currentYear: 1970 });
      // A US buyer acquiring a Soviet sector must still be refused: the gate
      // keys on where the production IS, not on who is buying.
      await expect(isPrivateEnterpriseBlocked(db, "RU")).resolves.toBe(true);
    });

    it("blocks in China and the union republics, which carried no config flag", async () => {
      const db = stubMarketizationDb({ currentYear: 1970 });
      for (const id of ["CN", "UKR", "BLR", "BAL"]) {
        await expect(isPrivateEnterpriseBlocked(db, id), id).resolves.toBe(true);
      }
    });

    it("permits a purchase of production sited in a market economy", async () => {
      const db = stubMarketizationDb({ currentYear: 1970 });
      await expect(isPrivateEnterpriseBlocked(db, "US")).resolves.toBe(false);
    });

    it("permits once the host country's dial crosses the ceiling", async () => {
      const db = stubMarketizationDb({ currentYear: 1970, levels: { RU: 55 } });
      await expect(isPrivateEnterpriseBlocked(db, "RU")).resolves.toBe(false);
    });
  });

  describe("listSectorForSale refuses a state enterprise", () => {
    const soeByOwner = {
      _id: new ObjectId(),
      countryOwnerId: "RU",
    } as unknown as Corporation;
    const soeByState = {
      _id: new ObjectId(),
      ownershipState: "stateOwned",
    } as unknown as Corporation;
    const privateCorp = {
      _id: new ObjectId(),
      ownershipState: "private",
    } as unknown as Corporation;

    it("treats a country-owned corporation as state-owned", () => {
      expect(isStateOwned(soeByOwner)).toBe(true);
    });

    it("treats an explicitly stateOwned corporation as state-owned", () => {
      expect(isStateOwned(soeByState)).toBe(true);
    });

    it("leaves a private corporation free to list", () => {
      expect(isStateOwned(privateCorp)).toBe(false);
    });
  });
});

describe("subsidiary spin-off is a creation path", () => {
  /**
   * Found during the branch audit: `spinOff` creates a brand-new PRIVATE
   * corporation in the parent's country and had no regime gate. Reachable
   * today, because the private corporations still sitting inside command
   * economies awaiting remediation could each spin off more.
   */
  it("blocks a spin-off whose parent sits in a command economy", async () => {
    const db = stubMarketizationDb({ currentYear: 1970 });
    for (const id of ["RU", "DD", "CN", "UKR"]) {
      await expect(isPrivateEnterpriseBlocked(db, id), id).resolves.toBe(true);
    }
  });

  it("permits a spin-off in a market economy", async () => {
    const db = stubMarketizationDb({ currentYear: 1970 });
    await expect(isPrivateEnterpriseBlocked(db, "US")).resolves.toBe(false);
  });
});

/**
 * Relocating a private corporation into a fully command economy is founding
 * private enterprise there by another route, so it is refused until the
 * country's marketization dial opens private enterprise (ticket 1378).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

const { isPrivateEnterpriseBlocked } = vi.hoisted(() => ({
  isPrivateEnterpriseBlocked: vi.fn(),
}));
vi.mock("@/lib/economy/queries/privateEnterpriseGate", () => ({ isPrivateEnterpriseBlocked }));

import {
  commandEconomyRelocationBlock,
  commandEconomyRelocationError,
} from "./relocationCommandEconomyGate";

const db = {} as Db;
const privateCorp = {};

beforeEach(() => {
  isPrivateEnterpriseBlocked.mockReset();
  isPrivateEnterpriseBlocked.mockImplementation(async (_db: Db, id: string) => id === "DD");
});

describe("commandEconomyRelocationBlock", () => {
  it("refuses a private corporation moving into a command economy", async () => {
    expect(await commandEconomyRelocationBlock(db, privateCorp, "UK", "DD")).toBe(
      commandEconomyRelocationError("DD")
    );
    expect(commandEconomyRelocationError("DD")).toMatch(/^East Germany has a state-run economy/);
  });

  it("lets it move into a market economy", async () => {
    expect(await commandEconomyRelocationBlock(db, privateCorp, "DD", "UK")).toBeNull();
  });

  it("never blocks a move inside the corporation's own country", async () => {
    expect(await commandEconomyRelocationBlock(db, privateCorp, "DD", "DD")).toBeNull();
    expect(isPrivateEnterpriseBlocked).not.toHaveBeenCalled();
  });

  it("exempts state-owned corporations", async () => {
    expect(
      await commandEconomyRelocationBlock(db, { countryOwnerId: "RU" }, "RU", "DD")
    ).toBeNull();
    expect(
      await commandEconomyRelocationBlock(db, { ownershipState: "stateOwned" }, "RU", "DD")
    ).toBeNull();
  });

  it("opens the same turn the dial opens private enterprise", async () => {
    isPrivateEnterpriseBlocked.mockResolvedValue(false);
    expect(await commandEconomyRelocationBlock(db, privateCorp, "UK", "DD")).toBeNull();
  });
});

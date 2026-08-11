/**
 * The org UI gate resolves `foreignMinisterOf` from the cabinet-seat holder in
 * the unified cabinetMembers collection. A player holding the foreign-affairs
 * seat must be recognized so their int-org vote buttons are enabled (regression
 * for the CN MoFA bug #0980: "Sign in as a foreign minister to vote" despite
 * holding the seat).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { loadViewerOrganizationRoles } from "./viewerRoles";
import { findCountryHeadedBy } from "@/lib/api/headOfGovernment";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

vi.mock("@/lib/api/headOfGovernment", () => ({
  findCountryHeadedBy: vi.fn(),
}));
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn(),
}));

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("cabinetMembers");
  db.collection("diplomaticActions");
  vi.mocked(findCountryHeadedBy).mockResolvedValue(null);
  vi.mocked(getCurrentTurn).mockResolvedValue(1);
});

describe("loadViewerOrganizationRoles — foreign-minister detection", () => {
  it("recognizes the cabinetMembers FM-seat holder as foreignMinisterOf", async () => {
    const fmCharId = new ObjectId();
    db.collectionMocks["cabinetMembers"]!.findOne.mockImplementation(
      async (filter: { countryId?: string; positionId?: string }) =>
        filter.countryId === "CN" && filter.positionId === "minister_of_foreign_affairs"
          ? {
              countryId: "CN",
              positionId: "minister_of_foreign_affairs",
              characterId: fmCharId,
              characterName: "Cassius MacInnis",
            }
          : null
    );

    const detail = await loadViewerOrganizationRoles({
      db: db as unknown as Db,
      characterId: fmCharId,
      characterName: "Cassius MacInnis",
    });

    expect(detail.foreignMinisterOf).toBe("CN");
  });
});

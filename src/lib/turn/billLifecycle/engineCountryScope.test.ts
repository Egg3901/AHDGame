import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { buildConfiguredCountryBillLifecycle } from "./configs/configuredCountry";
import { US_NATIONAL_CONFIG } from "./configs/us";
import { runBillLifecycle } from "./engine";
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn(),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));

describe("legacy country scopes in the shared lifecycle", () => {
  it("keeps a legacy UK joint ballot away from the US and resolves it in Commons", async () => {
    const mem = createInMemoryDb();
    const nppId = new ObjectId();
    mem.seed("bills", [
      {
        _id: new ObjectId(),
        stateId: "uk_national",
        status: "active_both",
        originChamber: "joint",
        currentChamber: "commons",
        votes: { [`npp_${nppId}`]: "for" },
        provisions: [],
        votingEndsOnTurn: 4,
        otherChamberVotingEndsOnTurn: 4,
        sponsorId: null,
      },
    ]);
    mem.seed("electedOfficials", [{ countryId: "UK", officeType: "commons", nppId, seatsHeld: 3 }]);
    const db = mem as unknown as Db;
    await runBillLifecycle(db, US_NATIONAL_CONFIG, new Date(100000000), 5);
    expect(mem.collection("bills").docs[0].status).toBe("active_both");
    await runBillLifecycle(db, buildConfiguredCountryBillLifecycle("UK"), new Date(100000000), 5);
    expect(mem.collection("bills").docs[0]).toMatchObject({ status: "signed", votesFor: 3 });
  });
  it("preserves an original US bill without a country field", async () => {
    const mem = createInMemoryDb();
    const nppId = new ObjectId();
    mem.seed("bills", [
      {
        _id: new ObjectId(),
        stateId: "federal",
        status: "active",
        originChamber: "house",
        currentChamber: "house",
        votes: { [`npp_${nppId}`]: "for" },
        provisions: [],
        votingEndsOnTurn: 4,
        sponsorId: null,
      },
    ]);
    mem.seed("electedOfficials", [{ countryId: "US", officeType: "house", nppId, seatsHeld: 3 }]);
    await runBillLifecycle(mem as unknown as Db, US_NATIONAL_CONFIG, new Date(100000000), 5);
    expect(mem.collection("bills").docs[0]).toMatchObject({ status: "active_other", votesFor: 3 });
  });
});

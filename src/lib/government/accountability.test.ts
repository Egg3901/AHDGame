import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { observeGovernmentAccountability, memberAccountabilityDrain } from "./accountability";

describe("government accountability observation", () => {
  it("batches attribution, preserves party tenure across nominees, and counts vacancies in majority thresholds", async () => {
    const mock = createMockDb();
    const rows = (name: string, docs: unknown[]) => {
      mock.collection(name).find.mockReturnValue({ toArray: async () => docs });
    };
    const leader = new ObjectId();
    mock
      .collection("gameState")
      .findOne.mockResolvedValue({ currentTurn: 800, preset: "1953-default" });
    rows("governmentFormations", [
      { _id: "US", countryId: "US", status: "formed", pmNppId: leader, governingPartyId: "stale" },
    ]);
    rows("electedOfficials", [
      { countryId: "US", state: "CA", officeType: "president", nppId: leader, party: "stale" },
      {
        countryId: "US",
        state: "CA",
        officeType: "house",
        nppId: new ObjectId(),
        party: "opposition",
        seatsHeld: 220,
      },
      {
        countryId: "US",
        state: "CA",
        officeType: "senate",
        nppId: new ObjectId(),
        party: "senateMajority",
        seatsHeld: 71,
      },
      {
        countryId: "US",
        state: "CA",
        officeType: "governor",
        nppId: new ObjectId(),
        party: "regional",
      },
      {
        countryId: "US",
        state: "CA",
        officeType: "stateSenate",
        nppId: new ObjectId(),
        party: "regional",
        seatsHeld: 20,
      },
    ]);
    rows("npps", [{ _id: leader, party: "executive" }]);
    rows("characters", []);
    rows("coalitions", []);
    rows("governmentApprovals", [{ _id: "US", approvalRating: 20 }]);
    rows("stateApprovalHistory", [
      { _id: "CA", stateId: "CA", countryId: "US", approvalRating: 20 },
    ]);
    rows("states", [{ _id: "CA", countryId: "US", stateSenateSeats: 40 }]);
    rows("countryState", [{ _id: "US", governmentType: "presidential" }]);
    rows("governmentAccountability", [
      { _id: "US:national:executive", sinceTurn: 1, lastObservedTurn: 799 },
    ]);

    const drains = await observeGovernmentAccountability(mock as unknown as Db);
    expect(drains.get("US:national:executive")).toBeCloseTo(0.225);
    expect(drains.get("US:national:opposition")).toBeCloseTo(0.01875);
    expect(drains.get("US:national:senateMajority")).toBeCloseTo(0.01875);
    // Half the full chamber, even with other seats vacant, is not a majority.
    expect(drains.get("US:CA:regional")).toBeCloseTo(0.1125);
    expect(drains.has("US:national:stale")).toBe(false);
    expect(mock.collectionMocks.governmentFormations.bulkWrite).toHaveBeenCalledWith([
      {
        updateOne: {
          filter: { _id: "US", status: "formed" },
          update: { $set: { governingPartyId: "executive" } },
        },
      },
    ]);
    for (const [name, collection] of Object.entries(mock.collectionMocks)) {
      if (name !== "gameState") expect(collection.find, name).toHaveBeenCalledTimes(1);
    }
    const query = mock.collectionMocks.electedOfficials.find.mock.calls[0];
    expect(query[1].projection).toMatchObject({
      countryId: 1,
      officeType: 1,
      party: 1,
      seatsHeld: 1,
    });
    expect(mock.collectionMocks.governmentAccountability.bulkWrite).toHaveBeenCalledTimes(1);
  });

  it("charges an unaffiliated executive without blaming unrelated independents or doubling regional costs", () => {
    const drains = new Map([
      ["US:national:@npp:leader", 0.1],
      ["US:CA:@npp:leader", 0.15],
    ]);
    expect(memberAccountabilityDrain(drains, "US", "CA", "independent", "npp:leader")).toBe(0.15);
    expect(memberAccountabilityDrain(drains, "US", "CA", "independent", "npp:challenger")).toBe(0);
  });
});

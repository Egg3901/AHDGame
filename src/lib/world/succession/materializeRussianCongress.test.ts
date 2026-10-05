import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  materializeProvisionalRussianCongress,
  FEDERATION_ARCHIVED_POLITICAL_ROWS_COLLECTION,
} from "./materializeRussianCongress";
import { loadRuntimeCountryOffices } from "@/lib/countries/runtimeOffices";
import { getLiveLowerChamberSeats } from "@/lib/legislature/lowerChamberSeats";
import { getCachedCountryState, setCachedCountryState } from "@/lib/countryState/cache";
import type { CountryState } from "@/lib/db/types/countryState";

const session = { inTransaction: () => true } as ClientSession;
const transfers = [
  {
    stateId: "RU_WEST",
    parentRegionId: null,
    topLevelRegionId: "RU_WEST",
    successorEntityId: "RU",
    leavesDetailedSource: false,
  },
  {
    stateId: "RU_EAST",
    parentRegionId: null,
    topLevelRegionId: "RU_EAST",
    successorEntityId: "RU",
    leavesDetailedSource: false,
  },
  {
    stateId: "SU_UA",
    parentRegionId: null,
    topLevelRegionId: "SU_UA",
    successorEntityId: "UA",
    leavesDetailedSource: true,
  },
];
function fixture() {
  const mem = createInMemoryDb();
  const slateId = new ObjectId();
  const playerId = new ObjectId();
  const departedId = new ObjectId();
  const executiveId = new ObjectId();
  mem.seed("gameState", [{ _id: "current", preset: "1991-default", currentTurn: 40 }]);
  mem.seed("countryGameStates", [{ _id: "RU" }]);
  mem.seed("countryState", [
    {
      _id: "RU",
      countryId: "RU",
      governmentType: "onePartyState",
      rulingPartyId: 1,
      hasLeaderConfidenceModel: true,
    },
  ]);
  mem.seed("states", [
    { _id: "RU_WEST", countryId: "RU", houseDistricts: 3 },
    { _id: "RU_EAST", countryId: "RU", houseDistricts: 7 },
  ]);
  mem.seed("electedOfficials", [
    {
      _id: new ObjectId(),
      countryId: "RU",
      officeType: "unionCongressDeputy",
      state: "RU_EAST",
      nppId: slateId,
      characterId: null,
      party: "1",
      seatsHeld: 3,
    },
    {
      _id: new ObjectId(),
      countryId: "RU",
      officeType: "unionCongressDeputy",
      state: "RU_WEST",
      characterId: playerId,
      party: "2",
      seatsHeld: 1,
    },
    {
      _id: new ObjectId(),
      countryId: "RU",
      officeType: "unionCongressDeputy",
      state: "SU_UA",
      nppId: departedId,
      characterId: null,
      party: "1",
      seatsHeld: 4,
    },
    {
      _id: new ObjectId(),
      countryId: "RU",
      officeType: "chairmanOfCabinet",
      nppId: executiveId,
      characterId: null,
    },
  ]);
  mem.seed("characters", [
    {
      _id: playerId,
      countryId: "RU",
      homeState: "RU_WEST",
      cash: 75,
      currentOffice: { type: "unionCongressDeputy", state: "RU_WEST" },
    },
  ]);
  mem.seed("npps", [
    {
      _id: slateId,
      countryId: "RU",
      homeState: "RU_EAST",
      funds: 125,
      currentOffice: { type: "unionCongressDeputy" },
    },
    {
      _id: departedId,
      countryId: "RU",
      homeState: "SU_UA",
      funds: 80,
      currentOffice: { type: "unionCongressDeputy" },
    },
    { _id: executiveId, countryId: "RU", currentOffice: { type: "chairmanOfCabinet" } },
    { _id: new ObjectId(), countryId: "UK", currentOffice: { type: "chairmanOfCabinet" } },
  ]);
  mem.seed("governmentFormations", [
    {
      _id: "RU",
      cycle: 2,
      status: "formed",
      pmNppId: executiveId,
      hosName: "Old Union",
      activeVoteId: new ObjectId(),
    },
  ]);
  mem.seed("pmAppointmentVotes", [
    { _id: new ObjectId(), countryId: "RU", status: "active" },
    { _id: new ObjectId(), countryId: "UK", status: "active" },
  ]);
  mem.seed("noConfidenceVotes", [{ _id: new ObjectId(), countryId: "RU", status: "active" }]);
  mem.seed("elections", [
    { _id: new ObjectId(), countryId: "RU", status: "upcoming" },
    { _id: new ObjectId(), countryId: "RU", status: "completed" },
  ]);
  mem.seed("cabinetMembers", [
    { _id: new ObjectId(), countryId: "RU" },
    { _id: new ObjectId(), countryId: "UK" },
  ]);
  return {
    mem,
    slateId,
    playerId,
    departedId,
    executiveId,
    input: {
      db: mem as unknown as Db,
      session,
      applicationId: "settlement",
      transfers,
      appliedOnTurn: 41,
      now: new Date(0),
    },
  };
}

describe("fresh Soviet settlement political handoff", () => {
  it("retains territorial deputies, conserves wallets and reopens ordinary Russian formation", async () => {
    const { mem, input, slateId, playerId, departedId, executiveId } = fixture();
    setCachedCountryState(
      input.db,
      mem.collection("countryState").docs[0] as unknown as CountryState
    );
    expect(await materializeProvisionalRussianCongress(input)).toEqual({
      retainedDeputies: 2,
      retiredOffices: 2,
      totalSeats: 10,
    });
    expect(await mem.collection("characters").findOne({ _id: playerId })).toMatchObject({
      countryId: "RU",
      homeState: "RU_WEST",
      cash: 75,
      currentOffice: { type: "congressDeputy" },
    });
    expect(await mem.collection("npps").findOne({ _id: slateId })).toMatchObject({
      funds: 125,
      currentOffice: { type: "congressDeputy", seatsHeld: 3 },
    });
    expect(await mem.collection("npps").findOne({ _id: departedId })).toMatchObject({
      funds: 80,
      currentOffice: null,
    });
    expect(await mem.collection("npps").findOne({ _id: executiveId })).toMatchObject({
      currentOffice: null,
    });
    expect(await mem.collection("npps").findOne({ countryId: "UK" })).toMatchObject({
      currentOffice: { type: "chairmanOfCabinet" },
    });
    expect(mem.collection("electedOfficials").docs).toHaveLength(2);
    expect(
      mem.collection("electedOfficials").docs.every((row) => row.officeType === "congressDeputy")
    ).toBe(true);
    expect(mem.collection(FEDERATION_ARCHIVED_POLITICAL_ROWS_COLLECTION).docs).toHaveLength(4);
    expect(await mem.collection("governmentFormations").findOne({ _id: "RU" })).toMatchObject({
      status: "pending",
      cycle: 2,
      pmNppId: null,
      hosName: null,
      activeVoteId: null,
      totalSeats: 10,
      majorityThreshold: 6,
      seatsByParty: { "1": 3, "2": 1 },
      pmVacancyDeadlineTurn: 137,
    });
    expect(await mem.collection("countryGameStates").findOne({ _id: "RU" })).toMatchObject({
      ruSovietSuccessionSinceTurn: 41,
      ruProvisionalCongressSeats: 10,
    });
    expect(await mem.collection("countryState").findOne({ _id: "RU" })).toMatchObject({
      governmentType: "parliamentaryRepublic",
      rulingPartyId: null,
      hasLeaderConfidenceModel: false,
    });
    expect(getCachedCountryState(input.db, "RU")).toBeUndefined();
    const layout = await loadRuntimeCountryOffices(input.db, "RU");
    expect(layout.config.legislature.lowerChamber.seats).toBe(10);
    expect(layout.lowerOfficeType).toBe("congressDeputy");
    expect(await getLiveLowerChamberSeats(input.db, "RU")).toBe(10);
    expect(await mem.collection("pmAppointmentVotes").findOne({ countryId: "RU" })).toMatchObject({
      status: "cancelled",
    });
    expect(await mem.collection("pmAppointmentVotes").findOne({ countryId: "UK" })).toMatchObject({
      status: "active",
    });
    expect(await mem.collection("elections").findOne({ status: "completed" })).not.toBeNull();
    expect(mem.collection("cabinetMembers").docs).toHaveLength(1);
  });

  it("rejects missing or pending retained players before political writes", async () => {
    const { mem, input, playerId } = fixture();
    await mem
      .collection("characters")
      .updateOne({ _id: playerId }, { $set: { federationPendingResidenceId: "other" } });
    await expect(materializeProvisionalRussianCongress(input)).rejects.toThrow("retained deputy");
    expect(mem.collection(FEDERATION_ARCHIVED_POLITICAL_ROWS_COLLECTION).docs).toEqual([]);
    expect(await mem.collection("npps").findOne({ countryId: "RU" })).toMatchObject({
      currentOffice: { type: "unionCongressDeputy" },
    });
  });

  it.each([{ ruPresidencySinceTurn: 30 }, { ruFederalAssemblySinceTurn: 30 }])(
    "preserves established Russian institutions %j while retiring obsolete Union offices",
    async (markers) => {
      const { mem, input, slateId } = fixture();
      await mem.collection("countryGameStates").updateOne({ _id: "RU" }, { $set: markers });
      const presidentId = new ObjectId();
      mem.collection("electedOfficials").docs.push({
        _id: new ObjectId(),
        countryId: "RU",
        officeType: "president",
        nppId: presidentId,
      });
      mem.collection("npps").docs.push({
        _id: presidentId,
        countryId: "RU",
        currentOffice: { type: "president" },
        funds: 900,
      });
      await mem
        .collection("electedOfficials")
        .updateOne({ nppId: slateId }, { $set: { officeType: "dumaDeputy" } });
      await mem
        .collection("npps")
        .updateOne({ _id: slateId }, { $set: { currentOffice: { type: "dumaDeputy" } } });
      await mem.collection("governmentFormations").updateOne(
        { _id: "RU" },
        {
          $set: {
            pmNppId: slateId,
            hosNppId: presidentId,
            presidentNppId: presidentId,
            status: "formed",
          },
        }
      );
      expect(await materializeProvisionalRussianCongress(input)).toMatchObject({
        retiredOffices: 3,
        totalSeats: null,
      });
      expect(await mem.collection("governmentFormations").findOne({ _id: "RU" })).toMatchObject({
        status: "formed",
        pmNppId: slateId,
        hosNppId: presidentId,
        presidentNppId: presidentId,
      });
      expect(await mem.collection("npps").findOne({ _id: presidentId })).toMatchObject({
        funds: 900,
        currentOffice: { type: "president" },
      });
      expect(await mem.collection("npps").findOne({ _id: slateId })).toMatchObject({
        funds: 125,
        currentOffice: { type: "dumaDeputy" },
      });
      expect(await mem.collection("countryGameStates").findOne({ _id: "RU" })).toMatchObject({
        ...markers,
        ruSovietSuccessionSinceTurn: 41,
      });
      expect(await mem.collection("countryGameStates").findOne({ _id: "RU" })).not.toHaveProperty(
        "ruProvisionalCongressSeats"
      );
    }
  );

  it("reopens only an obsolete Union premiership while keeping a Russian president", async () => {
    const { mem, input } = fixture();
    const presidentId = new ObjectId();
    await mem
      .collection("countryGameStates")
      .updateOne({ _id: "RU" }, { $set: { ruPresidencySinceTurn: 30 } });
    mem.collection("electedOfficials").docs.push({
      _id: new ObjectId(),
      countryId: "RU",
      officeType: "president",
      nppId: presidentId,
    });
    mem
      .collection("npps")
      .docs.push({ _id: presidentId, countryId: "RU", currentOffice: { type: "president" } });
    mem.collection("npps").docs.push({
      _id: new ObjectId(),
      countryId: "RU",
      currentOffice: { type: "parliamentaryCabinet" },
    });
    await mem
      .collection("governmentFormations")
      .updateOne({ _id: "RU" }, { $set: { presidentNppId: presidentId, hosNppId: presidentId } });
    await materializeProvisionalRussianCongress(input);
    expect(await mem.collection("governmentFormations").findOne({ _id: "RU" })).toMatchObject({
      status: "pending",
      pmNppId: null,
      presidentNppId: presidentId,
      hosNppId: presidentId,
    });
    expect(
      await mem
        .collection("npps")
        .countDocuments({ countryId: "RU", "currentOffice.type": "parliamentaryCabinet" })
    ).toBe(0);
    expect(await mem.collection("cabinetMembers").countDocuments({ countryId: "RU" })).toBe(0);
    expect(await mem.collection("cabinetMembers").countDocuments({ countryId: "UK" })).toBe(1);
  });

  it("accepts an explicit null succession marker from an older save", async () => {
    const { mem, input } = fixture();
    await mem
      .collection("countryGameStates")
      .updateOne({ _id: "RU" }, { $set: { ruSovietSuccessionSinceTurn: null } });
    expect(await materializeProvisionalRussianCongress(input)).toMatchObject({ totalSeats: 10 });
    expect(await mem.collection("countryGameStates").findOne({ _id: "RU" })).toMatchObject({
      ruSovietSuccessionSinceTurn: 41,
    });
  });

  it("requires an active transaction and a complete retained partition", async () => {
    const { input } = fixture();
    await expect(
      materializeProvisionalRussianCongress({
        ...input,
        session: { inTransaction: () => false } as ClientSession,
      })
    ).rejects.toThrow("transaction");
    await expect(
      materializeProvisionalRussianCongress({ ...input, transfers: [] })
    ).rejects.toThrow("territory");
  });

  it("uses one projected retained-player read and one projected NPC read", async () => {
    const { mem, input } = fixture();
    const playerRead = vi.spyOn(mem.collection("characters"), "find");
    const nppRead = vi.spyOn(mem.collection("npps"), "find");
    await materializeProvisionalRussianCongress(input);
    expect(playerRead).toHaveBeenCalledTimes(1);
    expect(nppRead).toHaveBeenCalledTimes(1);
    expect(nppRead).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ projection: { _id: 1 } })
    );
  });
});

import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { russianAssemblyVacancyScenario as scenario } from "./testing/assemblyVacancyScenario";
import { materializeRussianAssemblySeating as handover } from "./assemblySeating";
import { materializeRussianAssemblyVacancySeating as seat } from "./assemblyVacancySeating";
describe("Assembly vacancy seating", () => {
  it("seats a protected winner only after residence choice and preserves original terms and account", async () => {
    const { mem, input, playerId } = scenario("protected-player");
    expect(await handover(input)).toBe(true);
    expect(await seat({ ...input, turn: 146 })).toBe(false);
    delete mem.collection("characters").docs[0].federationPendingResidenceId;
    expect(await seat({ ...input, turn: 150, now: new Date(18010000) })).toBe(true);
    expect(mem.collection("characters").docs[0]).toMatchObject({
      money: 700,
      currentOffice: { type: "dumaDeputy", seatsHeld: 1 },
    });
    expect(
      mem
        .collection("electedOfficials")
        .docs.filter((row) => String(row.characterId) === String(playerId))
    ).toHaveLength(1);
    expect(mem.collection("russianAssemblySeatings").docs[1]).toMatchObject({
      revision: 1,
      dumaSeats: 450,
      termEndTurn: 237,
    });
    expect(mem.collection("countryGameStates").docs[0]).toMatchObject({
      ruFederalAssemblySinceTurn: 145,
    });
    expect(await seat({ ...input, turn: 151 })).toBe(false);
    expect(mem.collection("characters").docs[0].careerHistory).toHaveLength(1);
  });
  it("fills a failed Council subject with its fresh nominees while preserving every held office", async () => {
    const { mem, input, installRepeat } = scenario("council-repeat");
    expect(await handover(input)).toBe(true);
    const before = await mem.collection("electedOfficials").find({}).toArray();
    installRepeat();
    expect(
      await seat({ ...input, turn: 160, now: new Date(input.now.getTime() + 15 * 3600000) })
    ).toBe(true);
    const offices = mem.collection("electedOfficials").docs;
    expect(offices.filter((row) => row.officeType === "federationCouncilMember")).toHaveLength(178);
    for (const old of before)
      expect(offices.find((row) => String(row._id) === String(old._id))).toEqual(old);
    expect(mem.collection("russianAssemblySeatings").docs[1]).toMatchObject({
      revision: 1,
      councilSeats: 178,
      councilTermEndTurn: 237,
    });
    expect(mem.collection("russianCouncilElectionResults").docs[0].seatedOnTurn).toBe(160);
    expect(mem.collection("russianCouncilElectionResults").docs[1].seatedOnTurn).toBe(145);
    expect(await seat({ ...input, turn: 161 })).toBe(false);
  });
  it("moves a list deputy to a repeat constituency and restores their party's list allocation", async () => {
    const { mem, input, playerId, installRepeat } = scenario("list-transfer");
    expect(await handover(input)).toBe(true);
    const old = mem
      .collection("electedOfficials")
      .docs.find((row) => String(row.characterId) === String(playerId))!;
    expect(old.seatSource).toBe("list");
    installRepeat();
    expect(
      await seat({ ...input, turn: 160, now: new Date(input.now.getTime() + 15 * 3600000) })
    ).toBe(true);
    const own = mem
      .collection("electedOfficials")
      .docs.filter((row) => String(row.characterId) === String(playerId));
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ seatSource: "direct", seatsHeld: 1 });
    expect(
      mem.collection("electedOfficials").docs.some((row) => String(row._id) === String(old._id))
    ).toBe(false);
    expect(mem.collection("russianAssemblyOfficeArchives").docs).toHaveLength(2);
    expect(mem.collection("russianAssemblySeatings").docs[1]).toMatchObject({
      dumaSeats: 450,
      revision: 1,
    });
    expect(mem.collection("characters").docs[0]).toMatchObject({
      money: 700,
      currentOffice: { constituencyId: own[0].constituencyId },
    });
    expect(await seat({ ...input, turn: 161 })).toBe(false);
  });
  it.each(["clock", "unknown-office", "missing-root"])(
    "refuses %s without altering held offices",
    async (defect) => {
      const { mem, input, installRepeat } = scenario("council-repeat");
      await handover(input);
      installRepeat();
      if (defect === "clock")
        mem.collection("russianAssemblySeatings").docs[0].councilTermEndTurn = 238;
      if (defect === "unknown-office")
        mem
          .collection("electedOfficials")
          .docs.push({ _id: new ObjectId(), countryId: "RU", officeType: "dumaDeputy" });
      if (defect === "missing-root") mem.collection("russianAssemblySeatings").docs.splice(0);
      const before = await mem.collection("electedOfficials").find({}).toArray();
      await expect(
        seat({ ...input, turn: 160, now: new Date(input.now.getTime() + 15 * 3600000) })
      ).rejects.toThrow();
      expect(mem.collection("electedOfficials").docs).toEqual(before);
    }
  );
  it("fills a Duma vacancy while preserving the separately expired Council clock", async () => {
    const { mem, input } = scenario("protected-player");
    for (const poll of mem.collection("elections").docs)
      if (poll.russianCouncilRound) poll.endTurn = 139;
    await handover(input);
    delete mem.collection("characters").docs[0].federationPendingResidenceId;
    expect(
      await seat({ ...input, turn: 236, now: new Date(input.now.getTime() + 91 * 3600000) })
    ).toBe(true);
    expect(mem.collection("russianAssemblySeatings").docs[1]).toMatchObject({
      dumaSeats: 450,
      councilTermEndTurn: 235,
      dumaTermEndTurn: 237,
    });
  });
  it("does not fill vacancies after original terms expire", async () => {
    const { mem, input } = scenario("protected-player");
    await handover(input);
    delete mem.collection("characters").docs[0].federationPendingResidenceId;
    expect(await seat({ ...input, turn: 237 })).toBe(false);
    expect(mem.collection("characters").docs[0].currentOffice).toBeNull();
  });
});

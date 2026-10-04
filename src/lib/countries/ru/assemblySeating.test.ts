import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { russianAssemblySeatingRuntimeScenario as scenario } from "./testing/assemblySeatingRuntimeScenario";
import { materializeRussianAssemblySeating as seat } from "./assemblySeating";
describe("Joint Russian Assembly handover", () => {
  it("archives Congress, seats both chambers and preserves executive and financial accounts", async () => {
    const { mem, input } = scenario();
    expect(await seat(input)).toBe(true);
    const officials = mem.collection("electedOfficials").docs;
    expect(officials.filter((row) => row.officeType === "congressDeputy")).toHaveLength(0);
    expect(officials.filter((row) => row.officeType === "president")).toHaveLength(1);
    expect(
      officials
        .filter((row) => row.officeType === "dumaDeputy")
        .reduce((sum, row) => sum + Number(row.seatsHeld), 0)
    ).toBe(450);
    expect(officials.filter((row) => row.officeType === "federationCouncilMember")).toHaveLength(
      178
    );
    expect(mem.collection("russianAssemblyOfficeArchives").docs).toHaveLength(1);
    expect(mem.collection("russianAssemblySeatings").docs[0]).toMatchObject({
      dumaSeats: 450,
      councilSeats: 178,
      termEndTurn: 237,
      seatedOnTurn: 145,
    });
    expect(mem.collection("npps").docs.every((row) => row.money === 500)).toBe(true);
    expect(
      mem.collection("npps").docs.reduce((sum, row) => sum + Number(row.seatsHeld ?? 0), 0)
    ).toBe(628);
    expect(mem.collection("governmentFormations").docs[0]).toMatchObject({
      pmName: "Continuing PM",
      totalSeats: 450,
      majorityThreshold: 226,
      totalSeatsSupporting: 300,
      lostMajority: false,
    });
    expect(
      mem.collection("states").docs.reduce((sum, row) => sum + Number(row.houseDistricts), 0)
    ).toBe(225);
    const before = JSON.stringify(mem.collection("electedOfficials").docs);
    expect(await seat(input)).toBe(false);
    expect(JSON.stringify(mem.collection("electedOfficials").docs)).toBe(before);
  });
  it("records an unavailable Council profile as vacancies while preserving its protected status", async () => {
    const { mem, input, owners } = scenario();
    // One profile has 89 Council mandates; losing all of them leaves only89,
    // so the remaining chamber cannot authorize Congress replacement.
    mem.collection("npps").docs.find((row) => String(row._id) === owners[3])!.retiredAt = new Date(
      5000
    );
    expect(await seat(input)).toBe(false);
    expect(
      mem.collection("electedOfficials").docs.filter((row) => row.officeType === "congressDeputy")
    ).toHaveLength(1);
    expect(mem.collection("russianAssemblySeatings").docs).toHaveLength(0);
  });
  it.each([
    "missing-receipt",
    "wrong-mandate",
    "future-result",
    "missing-ballots",
    "existing-assembly",
    "missing-region",
  ])("preserves Congress on %s", async (defect) => {
    const { mem, input } = scenario();
    if (defect === "missing-receipt")
      mem.collection("russianCouncilElectionResults").docs.splice(0);
    if (defect === "wrong-mandate")
      mem.collection("russianDumaElectionResults").docs[0].mandateSinceTurn = 130;
    if (defect === "future-result")
      mem.collection("russianCouncilElectionResults").docs[0].resolvedOnTurn = 150;
    if (defect === "missing-ballots")
      delete mem.collection("russianDumaElectionResults").docs[0].ballots;
    if (defect === "existing-assembly")
      mem
        .collection("electedOfficials")
        .docs.push({ _id: new ObjectId(), countryId: "RU", officeType: "dumaDeputy" });
    if (defect === "missing-region") mem.collection("states").docs.pop();
    if (defect === "missing-receipt") expect(await seat(input)).toBe(false);
    else await expect(seat(input)).rejects.toThrow();
    expect(
      mem.collection("electedOfficials").docs.some((row) => row.officeType === "congressDeputy")
    ).toBe(true);
    expect(mem.collection("russianAssemblySeatings").docs).toHaveLength(0);
  });
  it("keeps a protected player and their account intact while recording an unfilled mandate", async () => {
    const { mem, input } = scenario();
    const player = new ObjectId();
    const receipt = mem.collection("russianDumaElectionResults").docs[0];
    const ballot = (
      receipt.ballots as Array<{
        candidates: Array<{ id: string; ownerId: string; isNpc: boolean }>;
      }>
    )[0];
    const winner = ballot.candidates[0];
    winner.ownerId = player.toHexString();
    winner.isNpc = false;
    const nominee = (
      receipt.nominees as Array<{ candidateId: ObjectId; ownerId: ObjectId; isNpc: boolean }>
    ).find((row) => row.candidateId.toHexString() === winner.id)!;
    nominee.ownerId = player;
    nominee.isNpc = false;
    mem.seed("characters", [
      {
        _id: player,
        countryId: "RU",
        federationPendingResidenceId: "protected-choice",
        money: 700,
        currentOffice: null,
      },
    ]);
    expect(await seat(input)).toBe(true);
    expect(mem.collection("russianAssemblySeatings").docs[0]).toMatchObject({
      dumaSeats: 449,
      dumaVacancies: 1,
      unavailableWinners: [
        expect.objectContaining({ ownerId: player.toHexString(), reason: "pending-relocation" }),
      ],
    });
    expect(mem.collection("characters").docs[0]).toMatchObject({
      federationPendingResidenceId: "protected-choice",
      money: 700,
      currentOffice: null,
    });
    expect(
      mem
        .collection("electedOfficials")
        .docs.some((row) => String(row.characterId) === player.toHexString())
    ).toBe(false);
  });
  it("seats an eligible player once with a career entry and preserves their wallet", async () => {
    const { mem, input } = scenario();
    const player = new ObjectId();
    const receipt = mem.collection("russianDumaElectionResults").docs[0];
    const winner = (
      receipt.ballots as Array<{
        candidates: Array<{ id: string; ownerId: string; isNpc: boolean }>;
      }>
    )[0].candidates[0];
    winner.ownerId = player.toHexString();
    winner.isNpc = false;
    const nominee = (
      receipt.nominees as Array<{ candidateId: ObjectId; ownerId: ObjectId; isNpc: boolean }>
    ).find((row) => row.candidateId.toHexString() === winner.id)!;
    nominee.ownerId = player;
    nominee.isNpc = false;
    mem.seed("characters", [{ _id: player, countryId: "RU", money: 700, currentOffice: null }]);
    expect(await seat(input)).toBe(true);
    expect(
      mem
        .collection("electedOfficials")
        .docs.filter((row) => String(row.characterId) === player.toHexString())
    ).toHaveLength(1);
    expect(mem.collection("characters").docs[0]).toMatchObject({
      money: 700,
      currentOffice: { type: "dumaDeputy", seatsHeld: 1 },
      careerHistory: [
        expect.objectContaining({
          type: "elected",
          office: { type: "dumaDeputy" },
          electionId: (receipt.ballots as Array<{ id: string }>)[0].id,
        }),
      ],
    });
  });
  it("keeps separate original chamber clocks when the first polls finish on different turns", async () => {
    const { mem, input } = scenario();
    for (const poll of mem.collection("elections").docs)
      if (poll.russianCouncilRound) poll.endTurn = 139;
    expect(await seat(input)).toBe(true);
    expect(mem.collection("russianAssemblySeatings").docs[0]).toMatchObject({
      dumaTermEndTurn: 237,
      councilTermEndTurn: 235,
      termEndTurn: 235,
    });
    const officials = mem.collection("electedOfficials").docs;
    expect(officials.find((row) => row.officeType === "dumaDeputy")!.termEnds).toEqual(
      new Date(input.now.getTime() + 92 * 3600000)
    );
    expect(officials.find((row) => row.officeType === "federationCouncilMember")!.termEnds).toEqual(
      new Date(input.now.getTime() + 90 * 3600000)
    );
  });
  it.each(["object", "legacy-string"])(
    "preserves first-convocation Duma Government roles with %s mirrors",
    async (representation) => {
      const { mem, input, owners } = scenario();
      const pm = mem.collection("npps").docs.find((row) => String(row._id) === owners[0])!;
      const minister = mem.collection("npps").docs.find((row) => String(row._id) === owners[2])!;
      pm.currentOffice =
        representation === "legacy-string" ? "primeMinister" : { type: "primeMinister" };
      minister.currentOffice = { type: "parliamentaryCabinet", positionId: "finance" };
      mem.collection("electedOfficials").docs.push({
        _id: new ObjectId(),
        countryId: "RU",
        officeType: "primeMinister",
        nppId: pm._id,
      });
      mem.seed("cabinetMembers", [
        {
          _id: new ObjectId(),
          countryId: "RU",
          nppId: minister._id,
          positionId: "finance",
          ministerialActions: 2,
        },
      ]);
      expect(await seat(input)).toBe(true);
      expect(pm).toMatchObject({
        currentOffice: { type: "primeMinister" },
        seatsHeld: 300,
        money: 500,
      });
      expect(minister).toMatchObject({
        currentOffice: { type: "parliamentaryCabinet", positionId: "finance" },
        seatsHeld: 75,
        money: 500,
      });
      expect(mem.collection("cabinetMembers").docs[0]).toMatchObject({ ministerialActions: 2 });
      expect(
        mem.collection("electedOfficials").docs.filter((row) => row.officeType === "primeMinister")
      ).toHaveLength(1);
    }
  );
  it("does not activate before January or extend an expired first term", async () => {
    const { mem, input } = scenario();
    expect(await seat({ ...input, turn: 141 })).toBe(false);
    expect(await seat({ ...input, turn: 237 })).toBe(false);
    expect(mem.collection("russianAssemblyOfficeArchives").docs).toHaveLength(0);
  });
});

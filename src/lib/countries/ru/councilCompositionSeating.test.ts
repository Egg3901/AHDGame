import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { councilFormationRuntimeScenario as enacted } from "./testing/councilFormationRuntimeScenario";
import { materializeRussianRegionalAuthorities as settle } from "./regionalCouncilAuthorities";
import { materializeRussianCouncilCompositionSeating as seat } from "./councilCompositionSeating";
import {
  materializeRussianCouncilFormationProposal as propose,
  authorizeRussianCouncilFormation as authorize,
} from "./councilFormationProposals";

describe("actual regional Council composition handover", () => {
  it("replaces only the elected Council and retains financial groups, Duma, executive and immutable first roots", async () => {
    const { mem, input } = await enacted();
    await settle(input);
    const otherOffices = JSON.stringify(
      mem
        .collection("electedOfficials")
        .docs.filter((row) => row.officeType !== "federationCouncilMember")
    );
    const accounts = JSON.stringify(
      mem.collection("npps").docs.map((row) => ({
        id: row._id,
        money: row.money,
        personalAccount: row.personalAccount,
      }))
    );
    const country = mem.collection("countryGameStates").docs[0],
      firstRoot = String(country.ruFirstCouncilElectionCohortId);
    expect(await seat(input)).toBe(true);
    const council = mem
      .collection("electedOfficials")
      .docs.filter((row) => row.officeType === "federationCouncilMember");
    expect(council).toHaveLength(178);
    expect(council.every((row) => row.isAppointment === true && row.seatsHeld === 1)).toBe(true);
    expect(new Set(council.map((row) => row.characterName)).size).toBe(178);
    expect(
      JSON.stringify(
        mem
          .collection("electedOfficials")
          .docs.filter((row) => row.officeType !== "federationCouncilMember")
      )
    ).toBe(otherOffices);
    expect(
      JSON.stringify(
        mem.collection("npps").docs.map((row) => ({
          id: row._id,
          money: row.money,
          personalAccount: row.personalAccount,
        }))
      )
    ).toBe(accounts);
    expect(String(country.ruFirstCouncilElectionCohortId)).toBe(firstRoot);
    expect(country.ruFederalAssemblySinceTurn).toBe(145);
    expect(country.ruCouncilComposition).toMatchObject({ mode: "regionalHeads", sinceTurn: 237 });
    const before = JSON.stringify(mem.collection("electedOfficials").docs);
    expect(await seat({ ...input, turn: 238 })).toBe(false);
    expect(JSON.stringify(mem.collection("electedOfficials").docs)).toBe(before);
  });
  it("leaves the elected Council in custody until enough actual regional representatives exist", async () => {
    const { mem, input } = await enacted("regionalDelegates", 461);
    await settle(input);
    for (const row of mem.collection("russianRegionalAuthorities").docs) delete row.delegate;
    const before = JSON.stringify(mem.collection("electedOfficials").docs);
    expect(await seat(input)).toBe(false);
    expect(JSON.stringify(mem.collection("electedOfficials").docs)).toBe(before);
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty("ruCouncilComposition");
  });
  it("preserves party defections and never resurrects an ended member under the same authority", async () => {
    const { mem, input } = await enacted();
    await settle(input);
    await seat(input);
    const council = mem
      .collection("electedOfficials")
      .docs.filter((row) => row.officeType === "federationCouncilMember");
    council[0].party = "2";
    mem.collection("electedOfficials").docs = mem
      .collection("electedOfficials")
      .docs.filter((row) => String(row._id) !== String(council[1]._id));
    expect(await seat({ ...input, turn: 238 })).toBe(true);
    expect(
      mem
        .collection("electedOfficials")
        .docs.filter((row) => row.officeType === "federationCouncilMember")
    ).toHaveLength(177);
    expect(
      mem
        .collection("electedOfficials")
        .docs.find((row) => String(row._id) === String(council[0]._id))?.party
    ).toBe("2");
    expect(await seat({ ...input, turn: 239 })).toBe(false);
    expect(
      mem
        .collection("electedOfficials")
        .docs.some((row) => String(row._id) === String(council[1]._id))
    ).toBe(false);
  });
  it("changes to delegates only after separate enactment and keeps actual remaining regional terms", async () => {
    const { mem, input } = await enacted();
    await settle(input);
    await seat(input);
    await settle({ ...input, turn: 429 });
    await seat({ ...input, turn: 429 });
    const later = { ...input, turn: 461 };
    const proposal = await propose({ ...later, mode: "regionalDelegates", sponsor: null });
    const bill = mem
      .collection("bills")
      .docs.find((row) => String(row._id) === String(proposal.billId))!;
    Object.assign(bill, { status: "signed", enactedAt: input.now });
    expect(await authorize({ ...later, proposalId: proposal._id })).toBe(true);
    expect(mem.collection("countryGameStates").docs[0].ruCouncilComposition.mode).toBe(
      "regionalHeads"
    );
    await settle(later);
    expect(await seat(later)).toBe(true);
    const latest = mem.collection("russianCouncilCompositionSeatings").docs.at(-1)!;
    expect(latest.mode).toBe("regionalDelegates");
    expect(latest.seats.every((row: { termEndTurn: number }) => row.termEndTurn === 621)).toBe(
      true
    );
    expect(
      latest.seats.every(
        (row: { personId: string; authorityPersonId: string }) =>
          row.personId !== row.authorityPersonId
      )
    ).toBe(true);
  });
  it("refuses a modified physical incumbent instead of retiring an unproven office", async () => {
    const { mem, input } = await enacted();
    await settle(input);
    await seat(input);
    mem
      .collection("electedOfficials")
      .docs.find((row) => row.officeType === "federationCouncilMember")!.seatsHeld = 2;
    await expect(seat(input)).rejects.toThrow("predecessor receipt");
  });
  it("preserves a player's existing regional executive office and protected residence choice", async () => {
    const { mem, input } = await enacted();
    await settle(input);
    const regional = mem.collection("russianRegionalAuthorities").docs[0],
      playerId = new ObjectId();
    // An explicit regional authority settlement exists before the ex-officio handover.
    regional.head = {
      ...regional.head,
      ownerId: playerId.toHexString(),
      isNpc: false,
      name: "Regional player",
    };
    mem.collection("characters").docs.push({
      _id: playerId,
      name: "Regional player",
      countryId: "RU",
      homeState: regional.regionId,
      party: "1",
      money: 800,
      currentOffice: { type: "governor", state: regional.regionId },
    });
    mem.collection("electedOfficials").docs.push({
      _id: new ObjectId(),
      countryId: "RU",
      officeType: "governor",
      characterId: playerId,
      state: regional.regionId,
    });
    expect(await seat(input)).toBe(true);
    const player = mem.collection("characters").docs[0];
    expect(player).toMatchObject({
      money: 800,
      currentOffice: { type: "governor", state: regional.regionId },
    });
    expect(player.careerHistory).toHaveLength(1);
    player.federationPendingResidenceId = "protected-choice";
    expect(await seat({ ...input, turn: 238 })).toBe(true);
    expect(player.federationPendingResidenceId).toBe("protected-choice");
    expect(player.currentOffice.type).toBe("governor");
    expect(
      mem
        .collection("electedOfficials")
        .docs.some(
          (row) =>
            row.officeType === "federationCouncilMember" &&
            String(row.characterId) === String(playerId)
        )
    ).toBe(false);
  });
});

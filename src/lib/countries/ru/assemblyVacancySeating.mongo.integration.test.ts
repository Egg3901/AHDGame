import type { Character, Election, ElectionCandidate } from "@/lib/db/types";
import { openRussianDumaRepeat } from "./dumaRepeatOpening";
import { admitRussianDumaRepeatNpcNominees } from "./dumaRepeatNpcAdmission";
import { validateRussianDumaPlayerFiling } from "./dumaPlayerFiling";
import { certifyRussianDumaRepeat } from "./dumaRepeatResult";
import { MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { russianAssemblyVacancyScenario as scenario } from "./testing/assemblyVacancyScenario";
import { materializeRussianAssemblySeating as handover } from "./assemblySeating";
import { materializeRussianAssemblyVacancySeating as seat } from "./assemblyVacancySeating";
const uri = process.env.FEDERATION_TEST_MONGO_URI;
type Fixture = { _id: string | ObjectId; [key: string]: unknown };
describe.skipIf(!uri)("Assembly vacancies on isolated Mongo", () => {
  let client: MongoClient;
  let commands = 0;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["localhost", "127.0.0.1"].includes(address.hostname))
      throw new Error("Assembly qualification requires explicit loopback Mongo");
    client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    client.on("commandStarted", () => {
      commands++;
    });
    await client.connect();
    const hello = await client.db("admin").command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary)
      throw new Error("Assembly qualification requires a writable replica-set primary");
  });
  afterAll(async () => {
    await client?.close();
  });
  it.each(["council-repeat", "list-transfer"] as const)(
    "rolls back %s on late receipt failure, retries and preserves held offices on replay",
    async (kind) => {
      const db = client.db(`ahd_test_assembly_vacancy_${new ObjectId().toHexString()}`);
      try {
        const fixture = scenario(kind);
        for (const [name, collection] of fixture.mem.collections)
          if (collection.docs.length)
            await db.collection<Fixture>(name).insertMany(collection.docs as Fixture[]);
        expect(
          await runRequiredTransaction((session) => handover({ ...fixture.input, db, session }), {
            client,
          })
        ).toBe(true);
        const receipt = fixture.installRepeat();
        await db
          .collection<Fixture>(
            kind === "list-transfer"
              ? "russianDumaElectionResults"
              : "russianCouncilElectionResults"
          )
          .insertOne(receipt);
        await db
          .collection<Fixture>("elections")
          .insertOne(fixture.mem.collection("elections").docs.at(-1)! as Fixture);
        const names = [
          "electedOfficials",
          "characters",
          "npps",
          "russianAssemblySeatings",
          "russianAssemblyOfficeArchives",
          "governmentFormations",
          "countryGameStates",
          "states",
          "russianDumaElectionResults",
          "russianCouncilElectionResults",
        ];
        const before = new Map<string, Fixture[]>();
        for (const name of names)
          before.set(name, await db.collection<Fixture>(name).find({}).sort({ _id: 1 }).toArray());
        await db.command({
          collMod: "russianAssemblySeatings",
          validator: { revision: { $exists: false } },
        });
        const claim = () =>
          runRequiredTransaction(
            (session) =>
              seat({
                ...fixture.input,
                db,
                session,
                turn: 160,
                now: new Date(fixture.input.now.getTime() + 15 * 3600000),
              }),
            {
              client,
            }
          );
        await expect(claim()).rejects.toMatchObject({ code: 121 });
        for (const name of names)
          expect(await db.collection<Fixture>(name).find({}).sort({ _id: 1 }).toArray()).toEqual(
            before.get(name)
          );
        await db.command({ collMod: "russianAssemblySeatings", validator: {} });
        commands = 0;
        expect(await claim()).toBe(true);
        expect(commands).toBeLessThanOrEqual(35);
        const journal = await db
          .collection<Fixture>("russianAssemblySeatings")
          .findOne({ revision: 1 });
        expect(journal).toMatchObject({
          dumaSeats: 450,
          councilSeats: 178,
          dumaTermEndTurn: 237,
          councilTermEndTurn: 237,
        });
        const offices = await db
          .collection<Fixture>("electedOfficials")
          .find({})
          .sort({ _id: 1 })
          .toArray();
        expect(new Set(offices.map((row) => String(row._id))).size).toBe(offices.length);
        expect(
          await db
            .collection<Fixture>("npps")
            .find({}, { projection: { money: 1, personalAccount: 1 } })
            .sort({ _id: 1 })
            .toArray()
        ).toEqual(
          before.get("npps")!.map((row) => ({
            _id: row._id,
            money: row.money,
            personalAccount: row.personalAccount,
          }))
        );
        if (kind === "list-transfer") {
          const playerOffices = await db
            .collection("electedOfficials")
            .find({ characterId: fixture.playerId })
            .toArray();
          expect(playerOffices).toHaveLength(1);
          expect(playerOffices[0]).toMatchObject({ seatSource: "direct", seatsHeld: 1 });
          expect(await db.collection("russianAssemblyOfficeArchives").countDocuments()).toBe(2);
        } else
          for (const old of before.get("electedOfficials")!)
            expect(offices.find((row) => String(row._id) === String(old._id))).toEqual(old);
        commands = 0;
        expect(await claim()).toBe(false);
        expect(commands).toBeLessThanOrEqual(5);
        expect(
          await db.collection<Fixture>("electedOfficials").find({}).sort({ _id: 1 }).toArray()
        ).toEqual(offices);
      } finally {
        await db.dropDatabase();
      }
    }
  );
  it("runs native post-handover opening, NPC admission, player filing, certification and list transfer", async () => {
    const db = client.db(`ahd_test_assembly_native_${new ObjectId().toHexString()}`);
    try {
      const fixture = scenario("list-transfer");
      for (const [index, profile] of fixture.mem.collection("npps").docs.entries()) {
        profile.party = String((index % 3) + 1);
        profile.name = `Synthetic profile ${index}`;
      }
      for (const region of fixture.mem.collection("states").docs) {
        region.population = 1000000;
        region.votingEligiblePopulation = 700000;
      }
      for (const [name, collection] of fixture.mem.collections)
        if (collection.docs.length)
          await db.collection<Fixture>(name).insertMany(collection.docs as Fixture[]);
      await db
        .collection("politicalParties")
        .insertMany(
          [1, 2, 3].map((sequentialId) => ({ _id: new ObjectId(), countryId: "RU", sequentialId }))
        );
      expect(
        await runRequiredTransaction((session) => handover({ ...fixture.input, db, session }), {
          client,
        })
      ).toBe(true);
      const opened = await openRussianDumaRepeat({
        db,
        rootCohortId: fixture.dumaRoot,
        previousResultId: fixture.dumaRoot.toHexString(),
        turn: 150,
        now: new Date(18010000),
      });
      expect(opened?.created).toBe(true);
      expect(opened!.record.electionIds).toHaveLength(1);
      const admission = {
        db,
        rootCohortId: fixture.dumaRoot,
        generation: 1,
        turn: 150,
        now: new Date(18010000),
      };
      expect((await admitRussianDumaRepeatNpcNominees(admission))?.created).toBe(3);
      const election = await db
        .collection<Election>("elections")
        .findOne({ _id: opened!.record.electionIds[0] });
      const character = await db
        .collection<Character>("characters")
        .findOne({ _id: fixture.playerId });
      const filing = await validateRussianDumaPlayerFiling({
        db,
        election: election!,
        character: character!,
        turn: 150,
        registrationOrder: 3,
      });
      expect(filing.allowed).toBe(true);
      if (!filing.allowed)
        throw new Error("Synthetic list deputy was unexpectedly barred from a repeat constituency");
      const candidateId = new ObjectId();
      await db.collection("electionCandidates").insertOne({
        _id: candidateId,
        electionId: election!._id,
        characterId: fixture.playerId,
        countryId: "RU",
        characterName: "Synthetic deputy",
        party: "1",
        status: "active",
        isNPP: false,
        russianDumaNomination: filing.nomination,
      });
      const candidates = await db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ electionId: election!._id })
        .toArray();
      expect(
        candidates
          .filter((row) => row.isNPP)
          .every((row) => !fixture.owners.slice(3).includes(row.nppId!.toHexString()))
      ).toBe(true);
      await db.collection("electionVoteTallies").insertOne({
        _id: new ObjectId(),
        electionId: election!._id,
        finalized: false,
        totalVotes: Object.fromEntries(
          candidates.map((row) => [
            row._id.toHexString(),
            row._id.equals(candidateId)
              ? Math.ceil(election!.russianDumaRound!.registeredVoters * 0.6)
              : 0,
          ])
        ),
        candidateParties: Object.fromEntries(
          candidates.map((row) => [row._id.toHexString(), row.party])
        ),
        russianDumaBallot: { againstAllVotes: 0 },
      });
      await db
        .collection("elections")
        .updateOne({ _id: election!._id }, { $set: { status: "completed" } });
      await db.command({
        collMod: "russianDumaElectionResults",
        validator: { generation: { $ne: 1 } },
      });
      const certification = {
        db,
        rootCohortId: fixture.dumaRoot,
        generation: 1,
        turn: election!.endTurn!,
        now: new Date(61210000),
      };
      await expect(certifyRussianDumaRepeat(certification)).rejects.toMatchObject({ code: 121 });
      expect(await db.collection("elections").findOne({ _id: election!._id })).toMatchObject({
        status: "completed",
      });
      expect(
        await db
          .collection("electionCandidates")
          .countDocuments({ electionId: election!._id, status: "active" })
      ).toBe(4);
      await db.command({ collMod: "russianDumaElectionResults", validator: {} });
      const result = await certifyRussianDumaRepeat(certification);
      expect(result.generation).toBe(1);
      const claim = () =>
        runRequiredTransaction(
          (session) =>
            seat({
              ...fixture.input,
              db,
              session,
              turn: election!.endTurn!,
              now: certification.now,
            }),
          { client }
        );
      expect(await claim()).toBe(true);
      const own = await db
        .collection("electedOfficials")
        .find({ characterId: fixture.playerId })
        .toArray();
      expect(own).toHaveLength(1);
      expect(own[0]).toMatchObject({ seatSource: "direct", seatsHeld: 1 });
      expect(await db.collection("characters").findOne({ _id: fixture.playerId })).toMatchObject({
        money: 700,
      });
      expect(await claim()).toBe(false);
      expect(await db.collection("russianAssemblySeatings").findOne({ revision: 1 })).toMatchObject(
        { dumaSeats: 450, termEndTurn: 237 }
      );
    } finally {
      await db.dropDatabase();
    }
  });
  it("admits exactly one concurrent residence-choice claim without cloning the character or extending terms", async () => {
    const db = client.db(`ahd_test_assembly_vacancy_${new ObjectId().toHexString()}`);
    try {
      const fixture = scenario("protected-player");
      for (const [name, collection] of fixture.mem.collections)
        if (collection.docs.length)
          await db.collection<Fixture>(name).insertMany(collection.docs as Fixture[]);
      expect(
        await runRequiredTransaction((session) => handover({ ...fixture.input, db, session }), {
          client,
        })
      ).toBe(true);
      await db
        .collection("characters")
        .updateOne({ _id: fixture.playerId }, { $unset: { federationPendingResidenceId: "" } });
      const claim = () =>
        runRequiredTransaction((session) => seat({ ...fixture.input, db, session, turn: 150 }), {
          client,
        });
      expect((await Promise.all([claim(), claim()])).sort()).toEqual([false, true]);
      expect(
        await db.collection("electedOfficials").countDocuments({ characterId: fixture.playerId })
      ).toBe(1);
      expect(await db.collection("characters").countDocuments()).toBe(1);
      expect(await db.collection("russianAssemblySeatings").countDocuments()).toBe(2);
      expect(await db.collection("characters").findOne({ _id: fixture.playerId })).toMatchObject({
        money: 700,
        careerHistory: [expect.objectContaining({ type: "elected" })],
      });
      expect(
        await db.collection<Fixture>("countryGameStates").findOne({ _id: "RU" })
      ).toMatchObject({ ruFederalAssemblySinceTurn: 145 });
    } finally {
      await db.dropDatabase();
    }
  });
});

/**
 * Opt-in persisted qualification of the explicitly modeled BR/IE aggregate
 * opening offices. Uses a disposable database on the sandbox Mongo port.
 */
import { randomUUID } from "node:crypto";
import { MongoClient, type Document } from "mongodb";
import { expect, it } from "vitest";
import { brRegions } from "@/lib/countries/br/data/brRegions";
import { ieRegions } from "@/lib/countries/ie/data/ieRegions";
import { brParties } from "@/lib/countries/br/data/brParties";
import { ieParties } from "@/lib/countries/ie/data/ieParties";
import { seedFromSeats, SLUG_TO_NAME } from "@/lib/npp/seedHistorical";
import {
  modeledBrMacroregionGovernors,
  modeledIeRegionalOffices,
} from "./aggregateRegionalOffices";

const runRealMongo = process.env.AHD_AGGREGATE_OFFICES_REAL_MONGO === "1";
const sandboxUri = "mongodb://127.0.0.1:27018";

it.skipIf(!runRealMongo)(
  "persists and converges modeled BR governors and IE councils/chairs in each supported preset",
  async () => {
    const client = await new MongoClient(sandboxUri).connect();
    try {
      for (const preset of ["1991-default", "2019-default", "2027-default"]) {
        const dbName = `ahd_sim_issue2072_aggregate_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
        const db = client.db(dbName);
        try {
          await db
            .collection<Document & { _id: string }>("states")
            .insertMany([...brRegions, ...ieRegions]);
          const roster = [
            ...modeledBrMacroregionGovernors(preset),
            ...modeledIeRegionalOffices(preset),
          ];
          const validParties = [...brParties, ...ieParties].filter(
            (party) => !party.validForPresets || party.validForPresets.includes(preset)
          );
          await db.collection("politicalParties").insertMany(
            validParties.map((party, index) => ({
              countryId: party.countryId,
              name: party.name,
              sequentialId: index + 1,
            }))
          );
          for (const seat of roster) {
            const partyName = SLUG_TO_NAME[seat.party];
            if (seat.party.endsWith("_independent")) continue;
            expect(partyName).toBeDefined();
            const countryId = seat.party.startsWith("br_") ? "BR" : "IE";
            expect(
              await db.collection("politicalParties").countDocuments({ countryId, name: partyName })
            ).toBe(1);
          }

          const first = await seedFromSeats(db, roster, "winners", {
            skipAlreadySeatedChambers: true,
            presetId: preset,
          });
          expect(first.nppsCreated).toBe(roster.length);
          expect(first.officialsCreated).toBe(roster.length);

          const officials = await db.collection("electedOfficials").find({}).toArray();
          const npps = await db.collection("npps").find({}).toArray();
          expect(officials).toHaveLength(roster.length);
          expect(npps).toHaveLength(roster.length);
          for (const countryId of ["BR", "IE"]) {
            const regions = countryId === "BR" ? brRegions : ieRegions;
            for (const region of regions) {
              const officeTypes = countryId === "BR" ? ["governor"] : ["governor", "localCouncil"];
              for (const officeType of officeTypes) {
                const expected = roster.filter(
                  (seat) => seat.state === region._id && seat.officeType === officeType
                );
                const seated = officials.filter(
                  (official) =>
                    official.countryId === countryId &&
                    official.state === region._id &&
                    official.officeType === officeType
                );
                expect(seated).toHaveLength(expected.length);
                expect(seated.reduce((sum, official) => sum + (official.seatsHeld ?? 1), 0)).toBe(
                  expected.reduce((sum, seat) => sum + (seat.seatsHeld ?? 1), 0)
                );
                for (const official of seated) {
                  const npp = npps.find((candidate) => candidate._id.equals(official.nppId));
                  expect(npp?.currentOffice?.type).toBe(officeType);
                  expect(npp?.currentOffice?.state).toBe(region._id);
                  expect(npp?.party).toBe(official.party);
                }
              }
            }
          }

          const second = await seedFromSeats(db, roster, "winners", {
            skipAlreadySeatedChambers: true,
            presetId: preset,
          });
          expect(second).toEqual({
            nppsCreated: 0,
            officialsCreated: 0,
            seatsSkipped: roster.length,
          });
          expect(await db.collection("electedOfficials").countDocuments({})).toBe(roster.length);
          expect(await db.collection("npps").countDocuments({})).toBe(roster.length);
        } finally {
          await db.dropDatabase();
        }
      }
    } finally {
      await client.close();
    }
  },
  120_000
);

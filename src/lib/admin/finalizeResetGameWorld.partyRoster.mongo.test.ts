import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Document } from "mongodb";
import { expect, it } from "vitest";
import { finalizeResetGameWorld } from "./finalizeResetGameWorld";
import { selectPartyRosterForPreset } from "@/lib/seeds/ensureDefaultParties";
import { frParties } from "@/lib/seeds/fr/frParties";
import { itParties } from "@/lib/seeds/it/itParties";
import { esParties } from "@/lib/seeds/es/esParties";
import { seParties } from "@/lib/seeds/se/seParties";
import { trParties } from "@/lib/seeds/tr/trParties";
import { csParties } from "@/lib/seeds/cs/csParties";
import { ukParties } from "@/lib/seeds/uk/ukParties";

it.skipIf(process.env.AHD_PARTY_FINALIZER_REAL_MONGO !== "1")(
  "preserves selected fallback party identities through the real reset finalizer",
  async () => {
    const client = await MongoClient.connect("mongodb://127.0.0.1:27018", { maxPoolSize: 2 });
    const target = `ahd_sim_issue2072_roster_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const db = client.db(target);
    try {
      await db.collection<Document & { _id: string }>("gameState").insertOne({
        _id: "current",
        preset: "2019-default",
        currentTurn: 1,
        currentYear: 2019,
      });
      await db.collection<Document & { _id: string }>("countryGameStates").insertMany([
        ...["FR", "IT", "ES", "SE", "TR"].map((countryId) => ({
          _id: countryId,
          status: "active",
        })),
        { _id: "CS", absentInEra: true },
      ]);
      const selected = [frParties, itParties, esParties, seParties, trParties]
        .flatMap((roster) => selectPartyRosterForPreset(roster, "2019-default"))
        .map((seed, index) => {
          const { validForPresets: _presets, seedOrder: _order, ...party } = seed;
          void _presets;
          void _order;
          return { ...party, _id: new ObjectId(), sequentialId: index + 1 };
        });
      const stale = [
        ...csParties,
        ...ukParties.filter(
          (p) =>
            p.validForPresets?.includes("1991-default") &&
            !p.validForPresets.includes("2019-default")
        ),
      ].map((party, index) => ({ ...party, _id: new ObjectId(), sequentialId: 1000 + index }));
      await db.collection("politicalParties").insertMany([...selected, ...stale]);
      await finalizeResetGameWorld(db, {
        preset: "2019-default",
        deleteProfiles: false,
        startingParties: "default",
        teardown: {} as never,
      });
      const persisted = await db
        .collection("politicalParties")
        .find(
          {
            _id: { $in: selected.map((p) => p._id) },
          },
          { projection: { _id: 1, sequentialId: 1, countryId: 1, name: 1 } }
        )
        .toArray();
      expect(persisted).toHaveLength(selected.length);
      expect(
        await db
          .collection("politicalParties")
          .countDocuments({ _id: { $in: stale.map((p) => p._id) } })
      ).toBe(0);
      for (const party of selected) {
        expect(persisted.find((p) => p._id.equals(party._id))?.sequentialId).toBe(
          party.sequentialId
        );
      }
    } finally {
      expect(db.databaseName).toBe(target);
      await db.dropDatabase();
      await client.close();
    }
  },
  120_000
);

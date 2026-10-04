/** Repair actual executive attribution without resetting an incumbent's mandate. */
import type { Migration } from "../types";
import type { GovernmentFormation, ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import type { ObjectId } from "mongodb";
import { leaderStateId } from "@/lib/government/leaderReference";
import { installNewLeader } from "@/lib/turn/rulingPartyConfidence";
import {
  getCountryConfig,
  getHeadOfGovernmentOfficeKey,
  type CountryId,
} from "@/lib/constants/countries";

export const migration: Migration = {
  id: "2026-10-04-government-accountability",
  description:
    "Repair governing-party attribution, initialize autonomous leader accountability and stamp legacy custom-party maturation",
  idempotent: true,
  async execute(db, { dryRun }) {
    const [formations, presidents, runtimes, game, parties] = await Promise.all([
      db
        .collection<GovernmentFormation>("governmentFormations")
        .find({ status: "formed" })
        .toArray(),
      db
        .collection<ElectedOfficial>("electedOfficials")
        .find(
          { officeType: "president" },
          { projection: { countryId: 1, party: 1, characterId: 1, nppId: 1, characterName: 1 } }
        )
        .toArray(),
      db
        .collection<{ _id: CountryId; governmentType: string; hasLeaderConfidenceModel?: boolean }>(
          "countryState"
        )
        .find({})
        .toArray(),
      db
        .collection<{ _id: string; currentTurn?: number; preset?: string }>("gameState")
        .findOne({ _id: "current" }),
      db
        .collection<PoliticalParty>("politicalParties")
        .find({
          isDefault: false,
          createdTurn: { $exists: false },
          nppElectionMatureAtTurn: { $exists: false },
        })
        .toArray(),
    ]);
    const turn = game?.currentTurn ?? 0;
    type Actor = { _id: ObjectId; party?: string };
    const [characters, npps] = await Promise.all([
      db
        .collection<Actor>("characters")
        .find(
          {
            _id: {
              $in: [
                ...formations.flatMap((g) => (g.pmCharacterId ? [g.pmCharacterId] : [])),
                ...presidents.flatMap((p) => (p.characterId ? [p.characterId] : [])),
              ],
            },
          },
          { projection: { party: 1 } }
        )
        .toArray(),
      db
        .collection<Actor>("npps")
        .find(
          {
            _id: {
              $in: [
                ...formations.flatMap((g) => (g.pmNppId ? [g.pmNppId] : [])),
                ...presidents.flatMap((p) => (p.nppId ? [p.nppId] : [])),
              ],
            },
          },
          { projection: { party: 1 } }
        )
        .toArray(),
    ]);
    let repaired = 0,
      initialized = 0;
    for (const gov of formations) {
      const runtime = runtimes.find((r) => r._id === gov.countryId);
      const president =
        runtime?.governmentType === "presidential" &&
        getCountryConfig(gov.countryId, game?.preset).electionSystems.headOfGovernment !==
          "parliamentary"
          ? presidents.find((p) => p.countryId === gov.countryId && (p.characterId || p.nppId))
          : null;
      const party =
        (president
          ? ((president.characterId
              ? characters.find((c) => c._id.equals(president.characterId!))?.party
              : npps.find((n) => president.nppId && n._id.equals(president.nppId))?.party) ??
            president.party)
          : undefined) ??
        (gov.pmCharacterId
          ? characters.find((c) => c._id.equals(gov.pmCharacterId!))?.party
          : npps.find((n) => gov.pmNppId && n._id.equals(gov.pmNppId))?.party);
      const repair: { governingPartyId?: string; formationType?: null } = {};
      if (party && party !== gov.governingPartyId) repair.governingPartyId = party;
      if (
        runtime?.governmentType === "presidential" &&
        getCountryConfig(gov.countryId, game?.preset).electionSystems.headOfGovernment !==
          "parliamentary" &&
        gov.formationType != null
      )
        repair.formationType = null;
      if (Object.keys(repair).length) {
        repaired++;
        if (!dryRun)
          await db
            .collection<GovernmentFormation>("governmentFormations")
            .updateOne({ _id: gov._id, status: "formed" }, { $set: repair });
      }
      if (gov.pmNppId && runtime?.hasLeaderConfidenceModel) {
        const reference = { kind: "npp" as const, id: gov.pmNppId };
        if (
          !(await db
            .collection("countryLeaderStates")
            .findOne({ _id: leaderStateId(gov.countryId, reference) }))
        ) {
          initialized++;
          if (!dryRun)
            await installNewLeader(
              db,
              gov.countryId,
              reference,
              getHeadOfGovernmentOfficeKey(gov.countryId, game?.preset),
              party ?? null,
              gov.formedTurn ?? turn
            );
        }
      }
    }
    for (const party of parties) {
      const age = Date.now() - new Date(party.createdAt).getTime();
      // Old saves have no reliable historical game-turn stamp. Preserve
      // already-earned maturity, and begin observing younger parties now.
      const matureAtTurn = Number.isFinite(age) && age >= 48 * 3600000 ? turn : turn + 48;
      if (!dryRun)
        await db.collection<PoliticalParty>("politicalParties").updateOne(
          {
            _id: party._id,
            createdTurn: { $exists: false },
            nppElectionMatureAtTurn: { $exists: false },
          },
          { $set: { nppElectionMatureAtTurn: matureAtTurn } }
        );
    }
    return {
      documentsScanned: formations.length + parties.length,
      documentsUpdated: repaired + parties.length,
      documentsInserted: initialized,
      notes: [
        `${dryRun ? "Would repair" : "Repaired"} ${repaired} governing parties; ${initialized} autonomous leader states; ${parties.length} maturation stamps. Continuous party tenure starts at first observation; no past tenure is invented.`,
      ],
    };
  },
};

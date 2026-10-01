/**
 * Fresh modern worlds have an unseated NPC field for each open default-party
 * contest: see seedModernOpeningCandidates. Historical officeholders and
 * No Parties player countries retain their opening state.
 */
import type { Db } from "mongodb";
import type {
  Counter,
  Election,
  ElectionCandidate,
  GameState,
  NPP,
  PoliticalParty,
  StatePartyOrg,
} from "@/lib/db/types";
import { getAllCountryAccess } from "@/lib/countryAccess";
import { isNationwideDirectExecutiveElection } from "@/lib/elections/nationwideExecutive";
import { canPartyFieldInState } from "@/lib/turn/nppEntryLogic";
import { DEFAULT_CANDIDATE_SUPPORT } from "@/lib/electionEngine/electionFormulaFactors";
import { generateNPP, type NPPGenerationContext } from "./generator";

/** Called only by fresh historical bootstrap, never by a turn or reference refresh. */
export async function seedModernOpeningCandidates(
  db: Db,
  preset: string,
  now: Date,
  log: (message: string) => void = () => {}
): Promise<number> {
  if (preset !== "1991-default" && preset !== "2019-default") return 0;
  const gs = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1, startingPartiesMode: 1 } });
  const access = await getAllCountryAccess(db);
  const races = await db
    .collection<Election>("elections")
    .find(
      { status: "active" },
      {
        projection: {
          _id: 1,
          countryId: 1,
          state: 1,
          electionType: 1,
          primaryEndTurn: 1,
          primaryEndTime: 1,
        },
      }
    )
    .sort({ countryId: 1, state: 1, _id: 1 })
    .toArray();
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ status: "active" }, { projection: { electionId: 1, nppId: 1, characterId: 1 } })
    .toArray();
  const covered = new Set(candidates.map((c) => String(c.electionId)));
  const empty = races.filter((r) => !covered.has(String(r._id)));
  if (empty.length === 0) return 0;
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ isDefault: true }, { projection: { sequentialId: 1, countryId: 1 } })
    .sort({ sequentialId: 1 })
    .toArray();
  const regions = await db
    .collection<{ _id: string; countryId: string }>("states")
    .find({}, { projection: { _id: 1, countryId: 1 } })
    .sort({ _id: 1 })
    .toArray();
  const orgs = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({}, { projection: { stateId: 1, partyId: 1, hasPresence: 1 } })
    .toArray();
  const orgByKey = new Map(orgs.map((o) => [`${o.stateId}:${o.partyId}`, o]));
  const orgStates = new Set(orgs.map((o) => o.stateId));
  // Plan and validate the entire field before any actor or candidate writes.
  const slots: Array<{ race: Election; party: PoliticalParty; homeState: string }> = [];
  for (const race of empty) {
    const country = race.countryId ?? "US";
    if (gs?.startingPartiesMode === "none" && ["US", "UK", "JP"].includes(country)) {
      log(`Excluded ${country}:${race.electionType}: No Parties player country`);
      continue;
    }
    if (!access[country]?.registered) {
      log(`Excluded ${country}:${race.electionType}: absent, dissolved or unregistered country`);
      continue;
    }
    const primaryOpen =
      typeof race.primaryEndTurn === "number" && typeof gs?.currentTurn === "number"
        ? race.primaryEndTurn > gs.currentTurn
        : race.primaryEndTime instanceof Date && race.primaryEndTime > now;
    if (!primaryOpen)
      throw new Error(
        `Opening ${country}:${race.electionType} has no field after its primary closed`
      );
    const national = isNationwideDirectExecutiveElection(race.electionType, race.state, country);
    const eligibleRegions = regions.filter(
      (r) => r.countryId === country && (national || r._id === race.state)
    );
    let slot: (typeof slots)[number] | undefined;
    for (const party of parties.filter((p) => (p.countryId ?? "US") === country)) {
      if (!Number.isSafeInteger(party.sequentialId)) continue;
      const home = eligibleRegions.find((r) =>
        canPartyFieldInState(
          orgByKey.get(`${r._id}:${party.sequentialId}`),
          orgStates.has(r._id),
          String(party.sequentialId)
        )
      );
      if (home) {
        slot = { race, party, homeState: home._id };
        break;
      }
    }
    if (!slot)
      throw new Error(
        `Opening ${country}:${race.electionType}:${race.state} has no eligible default-party field`
      );
    slots.push(slot);
  }
  if (slots.length === 0) return 0;
  const actors = await db
    .collection<NPP>("npps")
    .find(
      {},
      {
        projection: {
          _id: 1,
          name: 1,
          countryId: 1,
          party: 1,
          homeState: 1,
          retiredAt: 1,
          isTechnocrat: 1,
        },
      }
    )
    .toArray();
  const incumbents = await db
    .collection<{ nppId?: unknown }>("electedOfficials")
    .find({ nppId: { $exists: true } }, { projection: { nppId: 1 } })
    .toArray();
  const claimed = new Set([
    ...candidates.map((c) => String(c.nppId ?? c.characterId)),
    ...incumbents.map((o) => String(o.nppId)),
  ]);
  const context: NPPGenerationContext = { existingNames: new Set(actors.map((a) => a.name)) };
  const generated: NPP[] = [];
  const entries: ElectionCandidate[] = [];
  for (const { race, party, homeState } of slots) {
    const countryId = race.countryId ?? "US";
    const partyId = String(party.sequentialId);
    let actor = actors.find(
      (a) =>
        !a.retiredAt &&
        !a.isTechnocrat &&
        !claimed.has(String(a._id)) &&
        (a.countryId ?? "US") === countryId &&
        a.party === partyId &&
        a.homeState === homeState
    );
    if (!actor) {
      actor = await generateNPP(
        { countryId, party: partyId, state: homeState, year: Number(preset.slice(0, 4)) },
        context,
        db
      );
      generated.push(actor);
    }
    claimed.add(String(actor._id));
    entries.push({
      electionId: race._id,
      countryId,
      characterId: actor._id,
      characterName: actor.name,
      party: partyId,
      status: "active",
      support: DEFAULT_CANDIDATE_SUPPORT,
      enteredAt: now,
      isNPP: true,
      nppId: actor._id,
    } as ElectionCandidate);
  }
  if (generated.length > 0) {
    const counter = await db
      .collection<Counter>("counters")
      .findOneAndUpdate(
        { _id: "npp" },
        { $inc: { seq: generated.length } },
        { upsert: true, returnDocument: "after" }
      );
    if (!counter) throw new Error("Failed to reserve opening candidate IDs");
    generated.forEach((actor, index) => {
      actor.sequentialId = counter.seq - generated.length + index + 1;
    });
    await db.collection<NPP>("npps").insertMany(generated);
  }
  await db.collection<ElectionCandidate>("electionCandidates").insertMany(entries);
  log(
    `Seeded ${entries.length} modern opening candidate fields with ${generated.length} new unseated actors`
  );
  return entries.length;
}

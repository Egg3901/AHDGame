/**
 * NPC Russian governments can introduce separate constitutional bills after their
 * decision dates. processRussianConstitutionalNpcProposals leaves player-held
 * government or parliamentary choices to players and never retries rejected bills.
 */
import type { Db } from "mongodb";
import type { ElectedOfficial } from "@/lib/db/types/officials";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { loadRuntimeCountryOffices } from "@/lib/countries/runtimeOffices";
import {
  loadRussianConstitutionalDecisions,
  openRussianConstitutionalProposal,
  type RussianConstitutionalCalendar,
} from "./constitutionalProposals";
import {
  loadRussianCouncilFormationDecisions,
  openRussianCouncilFormationProposal,
} from "./councilFormationProposals";

export async function processRussianConstitutionalNpcProposals(
  db: Db,
  game: RussianConstitutionalCalendar,
  turn: number,
  now: Date
): Promise<number> {
  if (game.preset !== "1991-default") return 0;
  const decisions = [
    ...(await loadRussianConstitutionalDecisions(db, game, turn)),
    ...(await loadRussianCouncilFormationDecisions(db, game, turn)),
  ];
  const pending = decisions.filter((decision) => decision.available && !decision.proposal);
  if (!pending.length) return 0;
  const government = await getGovernmentFormationsCollection(db).findOne(
    { _id: "RU" },
    { projection: { status: 1, pmCharacterId: 1, pmNppId: 1 } }
  );
  if (government?.status !== "formed" || government.pmCharacterId || !government.pmNppId) return 0;
  const offices = await loadRuntimeCountryOffices(db, "RU", "1991-default");
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      { countryId: "RU", officeType: { $in: offices.jointSittingOfficeTypes } },
      { projection: { characterId: 1, nppId: 1, officeType: 1, party: 1 } }
    )
    .toArray();
  if (
    officials.some((official) => official.characterId) ||
    !officials.some((official) => official.nppId && official.officeType === offices.lowerOfficeType)
  )
    return 0;
  let opened = 0;
  for (const decision of pending) {
    if (decision.kind === "regionalHeads" || decision.kind === "regionalDelegates")
      await openRussianCouncilFormationProposal({
        db,
        game,
        turn,
        now,
        mode: decision.kind,
        sponsor: null,
      });
    else
      await openRussianConstitutionalProposal({
        db,
        game,
        turn,
        now,
        kind: decision.kind,
        sponsor: null,
      });
    opened += 1;
  }
  return opened;
}

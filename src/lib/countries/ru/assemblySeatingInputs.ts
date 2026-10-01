/**
 * Assembly handover binds both certified families to the current Russian mandate.
 * loadRussianAssemblySeatingInputs projects owner status in batches and keeps
 * missing or incompatible winners as explicit vacancies in the seating plan.
 */
import { type ClientSession, type Db, ObjectId } from "mongodb";
import type {
  Character,
  NPP,
  CountryGameState,
  ElectedOfficial,
  State,
  GameState,
  Election,
} from "@/lib/db/types";
import type { UnifiedCabinetMember } from "@/lib/db/types/unifiedCabinetMember";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { calendarTurn } from "@/lib/utils/gameDate";
import { ru1993LegislatureStage } from "./eras/1991";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";
import { planRussianAssemblySeating } from "./rules/assemblySeating";
import {
  applyRussianAssemblyOwnerEligibility,
  russianFirstAssemblyTermEndTurn,
  russianFirstAssemblyOfficeCompatible,
} from "./rules/assemblyOwnerEligibility";
import {
  RUSSIAN_DUMA_RESULTS_COLLECTION,
  type RussianDumaResultRecord,
} from "./dumaElectionResult";
import {
  RUSSIAN_COUNCIL_RESULTS_COLLECTION,
  type RussianCouncilResultRecord,
} from "./councilElectionResult";
function currentOfficeType(office: NPP["currentOffice"] | string) {
  return typeof office === "string" ? office : office?.type;
}
export async function loadRussianAssemblySeatingInputs(
  db: Db,
  session: ClientSession,
  turn: number
) {
  const game = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { session, batchSize: 1000, projection: { preset: 1, preIteration: 1, preIterationTurns: 1 } }
    );
  if (
    game?.preset !== "1991-default" ||
    ru1993LegislatureStage(
      calendarTurn(turn, {
        preIterationActive: game.preIteration?.active,
        preIterationTurns: game.preIterationTurns,
      })
    ) !== "federalAssembly"
  )
    return null;
  const country = await db.collection<CountryGameState>("countryGameStates").findOne(
    { _id: "RU" },
    {
      session,
      batchSize: 1000,
      projection: {
        ruSovietSuccessionSinceTurn: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
        ruFirstDumaElectionCohortId: 1,
        ruFirstCouncilElectionCohortId: 1,
        ruFederalAssemblySinceTurn: 1,
      },
    }
  );
  if (
    !country?.ruFirstDumaElectionCohortId ||
    !country.ruFirstCouncilElectionCohortId ||
    country.ruFederalAssemblySinceTurn != null ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    return null;
  const dumaRoot = country.ruFirstDumaElectionCohortId;
  const councilRoot = country.ruFirstCouncilElectionCohortId;
  const duma = await db
    .collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION)
    .findOne(
      {
        countryId: "RU",
        preset: "1991-default",
        $or: [{ cohortId: dumaRoot }, { rootCohortId: dumaRoot }],
      },
      { session, sort: { generation: -1 } }
    );
  const council = await db
    .collection<RussianCouncilResultRecord>(RUSSIAN_COUNCIL_RESULTS_COLLECTION)
    .findOne(
      {
        countryId: "RU",
        preset: "1991-default",
        $or: [{ cohortId: councilRoot }, { rootCohortId: councilRoot }],
      },
      { session, sort: { generation: -1 } }
    );
  if (!duma || !council) return null;
  for (const [receipt, root] of [
    [duma, dumaRoot],
    [council, councilRoot],
  ] as const) {
    if (
      receipt._id !== receipt.cohortId.toHexString() ||
      !(receipt.rootCohortId ?? receipt.cohortId).equals(root) ||
      receipt.mandateSinceTurn !== country.ruFederalAssemblyMandateSinceTurn ||
      !Number.isSafeInteger(receipt.resolvedOnTurn) ||
      receipt.resolvedOnTurn < receipt.mandateSinceTurn ||
      receipt.resolvedOnTurn > turn ||
      receipt.seatedOnTurn != null
    )
      throw new Error("Assembly handover needs current unseated certified families");
  }
  if (!duma.ballots) throw new Error("Assembly handover needs verified original Duma ballots");
  const nominees = (rows: RussianDumaResultRecord["nominees"]) =>
    rows.map((row) => ({
      ...row,
      candidateId: row.candidateId.toHexString(),
      ownerId: row.ownerId.toHexString(),
    }));
  const certified = planRussianAssemblySeating({
    duma: { generation: duma.generation, ballots: duma.ballots, nominees: nominees(duma.nominees) },
    council: {
      generation: council.generation,
      ballots: council.ballots,
      nominees: nominees(council.nominees),
    },
  });
  const boundPolls = await db
    .collection<Election>("elections")
    .find(
      {
        countryId: "RU",
        $or: [
          {
            _id: { $in: [...duma.ballots, ...council.ballots].map((row) => new ObjectId(row.id)) },
          },
          { "russianDumaRound.cohortId": dumaRoot },
          { "russianCouncilRound.cohortId": councilRoot },
        ],
      },
      {
        session,
        batchSize: 1000,
        projection: {
          endTurn: 1,
          status: 1,
          state: 1,
          seatId: 1,
          russianDumaRound: 1,
          russianCouncilRound: 1,
        },
      }
    )
    .toArray();
  for (const [receipt, chamber] of [
    [duma, "duma"],
    [council, "council"],
  ] as const)
    if (
      !boundPolls.some((poll) => {
        const round = chamber === "duma" ? poll.russianDumaRound : poll.russianCouncilRound;
        return (
          round?.cohortId.equals(receipt.cohortId) &&
          (round.generation ?? 0) === (receipt.generation ?? 0)
        );
      })
    )
      throw new Error("Assembly receipt needs resolved polls from its own certified generation");
  const firstPolls = boundPolls.filter(
    (row) =>
      row.russianDumaRound?.cohortId.equals(dumaRoot) ||
      row.russianCouncilRound?.cohortId.equals(councilRoot)
  );
  const byId = new Map(boundPolls.map((row) => [row._id.toHexString(), row]));
  for (const [receipt, root, ballots, chamber] of [
    [duma, dumaRoot, duma.ballots, "duma"],
    [council, councilRoot, council.ballots, "council"],
  ] as const)
    for (const ballot of ballots) {
      const poll = byId.get(ballot.id);
      const round = chamber === "duma" ? poll?.russianDumaRound : poll?.russianCouncilRound;
      if (
        !poll ||
        !round ||
        !(round.rootCohortId ?? round.cohortId).equals(root) ||
        (round.generation ?? 0) > (receipt.generation ?? 0) ||
        poll.status !== "resolved" ||
        poll.seatId !== ballot.seatId ||
        poll.state !== ballot.regionId ||
        round.registeredVoters !== ballot.registeredVoters ||
        poll.endTurn > receipt.resolvedOnTurn
      )
        throw new Error("Assembly receipt does not match its resolved frozen elections");
    }
  if (
    firstPolls.length !== 315 ||
    firstPolls.filter((row) => row.russianDumaRound?.cohortId.equals(dumaRoot)).length !== 226 ||
    firstPolls.filter((row) => row.russianCouncilRound?.cohortId.equals(councilRoot)).length !==
      89 ||
    firstPolls.some(
      (row) =>
        row.status !== "resolved" ||
        !Number.isSafeInteger(row.endTurn) ||
        row.endTurn > turn ||
        row.endTurn < country.ruFederalAssemblyMandateSinceTurn!
    )
  )
    throw new Error("Assembly handover needs its complete original resolved polls");
  const dumaTermEndTurn = russianFirstAssemblyTermEndTurn(
    firstPolls
      .filter((row) => row.russianDumaRound?.cohortId.equals(dumaRoot))
      .map((row) => row.endTurn),
    TURNS_PER_YEAR
  );
  const councilTermEndTurn = russianFirstAssemblyTermEndTurn(
    firstPolls
      .filter((row) => row.russianCouncilRound?.cohortId.equals(councilRoot))
      .map((row) => row.endTurn),
    TURNS_PER_YEAR
  );
  const termEndTurn = Math.min(dumaTermEndTurn, councilTermEndTurn);
  if (turn >= termEndTurn) return null;
  const chars = certified.owners
    .filter((row) => !row.isNpc)
    .map((row) => new ObjectId(row.ownerId));
  const npps = certified.owners.filter((row) => row.isNpc).map((row) => new ObjectId(row.ownerId));
  const characters = chars.length
    ? await db
        .collection<Character>("characters")
        .find(
          { _id: { $in: chars } },
          {
            session,
            batchSize: 1000,
            projection: { _id: 1, countryId: 1, federationPendingResidenceId: 1, currentOffice: 1 },
          }
        )
        .toArray()
    : [];
  const profiles = npps.length
    ? await db
        .collection<NPP>("npps")
        .find(
          { _id: { $in: npps } },
          {
            session,
            batchSize: 1000,
            projection: { _id: 1, countryId: 1, retiredAt: 1, isTechnocrat: 1, currentOffice: 1 },
          }
        )
        .toArray()
    : [];
  const identities = [
    ...(chars.length ? [{ characterId: { $in: chars } }] : []),
    ...(npps.length ? [{ nppId: { $in: npps } }] : []),
  ];
  // Actual office and cabinet records are authoritative even if a mirror is stale.
  const offices = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ $or: [{ countryId: "RU" }, ...identities] }, { session, batchSize: 10000 })
    .toArray();
  if (offices.some((row) => ["dumaDeputy", "federationCouncilMember"].includes(row.officeType)))
    throw new Error("Assembly handover cannot overwrite unjournaled chamber offices");
  const cabinet = identities.length
    ? await db
        .collection<UnifiedCabinetMember>("cabinetMembers")
        .find(
          { $or: identities },
          { session, batchSize: 1000, projection: { characterId: 1, nppId: 1, countryId: 1 } }
        )
        .toArray()
    : [];
  const incompatible = new Set<string>();
  const chambers = new Map(
    certified.owners.map((row) => [
      `${row.isNpc ? "npc" : "player"}:${row.ownerId}`,
      row.officeType,
    ])
  );
  for (const row of [
    ...offices,
    ...cabinet.map((row) => ({ ...row, officeType: "parliamentaryCabinet" })),
  ]) {
    for (const [kind, ownerId] of [
      ["player", row.characterId],
      ["npc", row.nppId],
    ] as const) {
      if (!ownerId) continue;
      const key = `${kind}:${ownerId.toHexString()}`;
      const chamber = chambers.get(key);
      if (chamber && !russianFirstAssemblyOfficeCompatible(chamber, row.officeType, row.countryId))
        incompatible.add(key);
    }
  }
  const governmentOffices = new Map(
    [
      ...characters.map((row) => ({
        key: `player:${row._id.toHexString()}`,
        office:
          typeof row.currentOffice === "string" ? { type: row.currentOffice } : row.currentOffice,
      })),
      ...profiles.map((row) => ({
        key: `npc:${row._id.toHexString()}`,
        office:
          typeof row.currentOffice === "string" ? { type: row.currentOffice } : row.currentOffice,
      })),
    ]
      .filter(
        (row) => row.office && ["primeMinister", "parliamentaryCabinet"].includes(row.office.type)
      )
      .map((row) => [row.key, row.office!])
  );
  const statuses = [
    ...characters.map((row) => ({
      ownerId: row._id.toHexString(),
      isNpc: false,
      countryId: row.countryId,
      pendingRelocation: row.federationPendingResidenceId != null,
      retired: false,
      isTechnocrat: false,
      incompatibleOffice:
        incompatible.has(`player:${row._id.toHexString()}`) ||
        !russianFirstAssemblyOfficeCompatible(
          chambers.get(`player:${row._id.toHexString()}`)!,
          currentOfficeType(row.currentOffice),
          row.countryId
        ),
    })),
    ...profiles.map((row) => ({
      ownerId: row._id.toHexString(),
      isNpc: true,
      countryId: row.countryId,
      pendingRelocation: false,
      retired: row.retiredAt != null,
      isTechnocrat: row.isTechnocrat === true,
      incompatibleOffice:
        incompatible.has(`npc:${row._id.toHexString()}`) ||
        !russianFirstAssemblyOfficeCompatible(
          chambers.get(`npc:${row._id.toHexString()}`)!,
          currentOfficeType(row.currentOffice),
          row.countryId
        ),
    })),
  ];
  const plan = applyRussianAssemblyOwnerEligibility(certified.seats, statuses);
  if (!plan.canReplaceCongress) return null;
  const allocation: Record<string, number> = {};
  for (const row of duma.ballots.filter((row) => row.tier === "constituency"))
    allocation[row.regionId] = (allocation[row.regionId] ?? 0) + 1;
  const regions = await db
    .collection<State>("states")
    .find({ countryId: "RU" }, { session, batchSize: 1000, projection: { _id: 1 } })
    .toArray();
  if (
    regions.length !== Object.keys(allocation).length ||
    regions.some((row) => allocation[row._id] == null)
  )
    throw new Error("Assembly handover needs all frozen Duma regions");
  return {
    country,
    duma,
    council,
    dumaRoot,
    councilRoot,
    certified,
    plan,
    allocation,
    regions,
    governmentOffices,
    termEndTurn,
    dumaTermEndTurn,
    councilTermEndTurn,
    congress: offices.filter(
      (row) => row.countryId === "RU" && row.officeType === "congressDeputy"
    ),
  };
}

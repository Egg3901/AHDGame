/**
 * The primary state operations hub: everything a candidate does to a state, and
 * everything being done to them.
 *
 * Assembled here rather than in the component so the figures are unit-testable
 * and so no price is typed into markup. Reuses `buildPrimaryViewerCampaign` and
 * `loadStateTravelOptions` rather than rebuilding either: two sources
 * eventually quote two prices for one action, which this branch has already
 * had to fix twice.
 */

import type { Db } from "mongodb";
import type {
  Character,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  CharacterStateOrg,
  PrimaryStateAction,
} from "@/lib/db/types";
import { isPrimaryEnded } from "@/lib/elections/phases";
import { getGameTime } from "@/lib/time/gameTime";
import { buildPrimaryViewerCampaign } from "@/lib/elections/primaryPartyDetail";
import { loadStateTravelOptions } from "@/lib/elections/stateTravelOptions";
import { loadLiveStateActions } from "@/lib/elections/primaryStateActions";
import { buildCandidateColorMap } from "@/lib/campaigns/candidateColor";
import { getOpsBranchMagnitude } from "@/lib/campaigns/upgradeCosts";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { stateOrgLevelCost } from "@/lib/electionEngine/constants";
import {
  PRIMARY_LOCAL_ATTACK_COST_ACTIONS,
  PRIMARY_LOCAL_ATTACK_COST_FUNDS,
  PRIMARY_LOCAL_ATTACK_FAV_PER_TURN,
  PRIMARY_STATE_ATTACK_DURATION_TURNS,
} from "@/lib/electionEngine/constants";
import type {
  LiveAttackRow,
  OpponentRow,
  StateOperationsView,
  StatePresenceRow,
} from "@/lib/elections/dto/stateOperations";
import type { Campaign } from "@/lib/db/types";

export type { StateOperationsView };

/**
 * Assemble the hub, or null when there is nothing to act on: a race that is not
 * a live US presidential primary, or a viewer with no active candidacy in it.
 */
export async function buildStateOperations(
  db: Db,
  args: { election: Election; character: Character }
): Promise<StateOperationsView | null> {
  const { election, character } = args;
  if (election.electionType !== "president" || election.countryId !== "US") return null;
  if (election.status !== "active") return null;

  const gameTime = await getGameTime();
  const currentTurn = gameTime.currentTurn;
  // State operations are a primary mechanic. Once the primary closes the
  // general's own levers take over.
  if (isPrimaryEnded(election, currentTurn, gameTime)) return null;

  const roster = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ electionId: election._id, party: character.party, status: "active" })
    .toArray();

  const mine =
    roster.find(
      (c) => !c.isNPP && c.characterId && c.characterId.toString() === character._id.toString()
    ) ?? null;
  // Only a candidate has anything to press here: every action spends their own
  // pools and the routes gate on the authenticated character.
  if (!mine) return null;

  const camp = await buildPrimaryViewerCampaign(db, {
    viewerCandidate: mine,
    viewerCharacter: character,
  });
  if (!camp) return null;

  const { stateNameById } = await loadStateTravelOptions(db);

  // ── Presence ──────────────────────────────────────────────────────────────
  // Presence is charged to the campaign in its own currency, so the ladder is
  // quoted in it too. `stateOrgLevelCost` is anchor-denominated.
  const forexEnabled = await isForexEnabled();
  const { rate } = forexEnabled
    ? await loadCharacterFxRate(db, getHomeCurrency(character))
    : { rate: 1 };

  const orgRows = await db
    .collection<CharacterStateOrg>("characterStateOrg")
    .find({ characterId: character._id })
    .toArray();
  const presence: StatePresenceRow[] = orgRows
    .filter((r) => r.level > 0)
    .sort((a, b) => b.level - a.level || a.stateId.localeCompare(b.stateId))
    .map((r) => ({
      stateId: r.stateId,
      name: stateNameById[r.stateId] ?? r.stateId,
      level: r.level,
      nextCost: stateOrgLevelCost(r.level) * rate,
    }));

  // ── The field ─────────────────────────────────────────────────────────────
  const tally = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .findOne({ electionId: election._id });
  const delegatesByCandidate = tally?.primaryDelegates?.[character.party ?? ""] ?? {};

  // Campaign colours must come from the campaigns, not be assumed absent: a
  // candidate who has set one takes it and does NOT consume a palette slot, so
  // passing null for them would shift every later candidate's colour and the
  // field here would disagree with the board on the primary screen.
  const candidateKeys = roster
    .map((c) => (c.isNPP ? c.nppId : c.characterId))
    .filter((id): id is NonNullable<typeof id> => id != null);
  const rosterCampaigns = candidateKeys.length
    ? await db
        .collection<Campaign>("campaigns")
        .find({ electionId: election._id, candidateId: { $in: candidateKeys } })
        .project<{ candidateId: (typeof candidateKeys)[number]; color?: string | null }>({
          candidateId: 1,
          color: 1,
        })
        .toArray()
    : [];
  const colorByKey = new Map(
    rosterCampaigns.map((c) => [c.candidateId.toString(), c.color ?? null])
  );

  const colorById = buildCandidateColorMap(
    roster.map((c) => {
      const key = c.isNPP ? c.nppId?.toString() : c.characterId.toString();
      return {
        candidateId: c._id.toString(),
        campaignColor: key ? (colorByKey.get(key) ?? null) : null,
      };
    }),
    character.party ?? "",
    undefined
  );

  const liveRows = await loadLiveStateActions(db, {
    electionId: election._id,
    currentTurn,
  });
  const myRowId = mine._id.toString();

  const toAttackRow = (a: PrimaryStateAction, actorName?: string): LiveAttackRow => ({
    kind: a.kind,
    stateId: a.stateId,
    stateName: stateNameById[a.stateId] ?? a.stateId,
    ...(actorName ? { actorName } : {}),
    expiresTurn: a.expiresTurn,
  });

  const nameByRowId = new Map(roster.map((c) => [c._id.toString(), c.characterName ?? "Unknown"]));

  const opponents: OpponentRow[] = roster
    .filter((c) => c._id.toString() !== myRowId)
    .map((c) => {
      const id = c._id.toString();
      return {
        candidateId: id,
        name: c.characterName ?? "Unknown",
        color: colorById[id] ?? "#8f8f9d",
        delegates: delegatesByCandidate[id] ?? 0,
        liveAgainstThem: liveRows
          .filter(
            (a) =>
              a.actorCandidateId.toString() === myRowId && a.targetCandidateId.toString() === id
          )
          .map((a) => toAttackRow(a)),
      };
    })
    .sort((a, b) => b.delegates - a.delegates || a.name.localeCompare(b.name));

  const liveAgainstYou: LiveAttackRow[] = liveRows
    .filter((a) => a.targetCandidateId.toString() === myRowId)
    .map((a) => toAttackRow(a, nameByRowId.get(a.actorCandidateId.toString()) ?? "Unknown"));

  // ── The viewer's shield ───────────────────────────────────────────────────
  // The same Rapid Response branch that blunts the national oppo drain. Read so
  // the panel can say why a hit landed softer than advertised.
  const myCampaign = await db
    .collection<Campaign>("campaigns")
    .findOne({ electionId: election._id, candidateId: character._id });
  const shieldTree = myCampaign?.mediaSpendingTree;
  const shieldPct =
    shieldTree?.starter && shieldTree.c > 0
      ? getOpsBranchMagnitude("mediaSpending", "c", shieldTree.c)
      : 0;

  return {
    electionId: election._id.toString(),
    currentTurn,
    positives: {
      camp,
      presence,
      canvass: camp.currentCampaignState
        ? { available: true, stateId: camp.currentCampaignState, reason: null }
        : { available: false, stateId: null, reason: "Camp in a state to canvass there." },
    },
    opponents,
    liveAgainstYou,
    shieldPct,
    campaignFunds: myCampaign?.funds ?? 0,
    campaignFxRate: rate,
    localAttack: {
      costFunds: PRIMARY_LOCAL_ATTACK_COST_FUNDS * rate,
      costActions: PRIMARY_LOCAL_ATTACK_COST_ACTIONS,
      perTurn: PRIMARY_LOCAL_ATTACK_FAV_PER_TURN,
      turns: PRIMARY_STATE_ATTACK_DURATION_TURNS,
    },
  };
}

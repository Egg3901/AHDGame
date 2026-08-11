import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type {
  Election,
  ElectionCandidate,
  Character,
  NPP,
  PoliticalParty,
  CareerEvent,
  OfficeType,
} from "@/lib/db/types";
import { getOfficeLabel } from "@/lib/utils/politics";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { sendCountryGameEvent, DISCORD_COLORS, type DiscordEmbed } from "@/lib/discordWebhooks";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import { getGameStateCollection } from "@/lib/db/collections";
import { isNppContingentId } from "@/lib/turn/election/contingentPersonIds";
import type { ContingentElectionResult } from "@/lib/turn/election/contingentElection";
import { logger } from "../../observability/logger";

export type PresidentialResolutionMode = "majority" | "contingent" | "contingent_deadlock";

export interface PresidentMessagingContext {
  election: Election;
  ranked: [string, number][];
  candidateMap: Map<string, ElectionCandidate>;
  winnerId: string;
  winnerCandidate: ElectionCandidate;
  winnerEV: number;
  resolutionMode: PresidentialResolutionMode;
  tiedEv: number;
  contingentResult?: ContingentElectionResult;
  vpCharId?: ObjectId;
  now: Date;
}

export async function sendPresidentResolutionMessaging(
  db: Db,
  ctx: PresidentMessagingContext
): Promise<void> {
  const {
    election,
    ranked,
    candidateMap,
    winnerId,
    winnerCandidate,
    winnerEV,
    resolutionMode,
    tiedEv,
    contingentResult,
    vpCharId,
    now,
  } = ctx;

  await recordPresidentLeaderChange(db, ctx).catch((err) =>
    logger.error("countryHistory", "president leader_change failed", err)
  );

  if (!winnerCandidate.isNPP && winnerCandidate.characterId) {
    const char = await db
      .collection<Character>("characters")
      .findOne({ _id: winnerCandidate.characterId }, { projection: { userId: 1 } });
    if (char) {
      const houseDelegationVotes = contingentResult?.houseVoteTotals[winnerId] ?? 0;
      const isContingent =
        resolutionMode === "contingent" || resolutionMode === "contingent_deadlock";
      const winMessage = isContingent
        ? tiedEv > 0
          ? `Congratulations! The Electoral College tied ${tiedEv}–${tiedEv} with no majority. The House of Representatives chose you as President with ${houseDelegationVotes} state delegation vote(s).`
          : `Congratulations! No candidate reached 270 electoral votes. The House of Representatives chose you as President with ${houseDelegationVotes} state delegation vote(s) (${winnerEV} EV).`
        : `Congratulations! You won the presidential election with ${winnerEV} electoral votes.`;
      await createNotifications([
        {
          userId: char.userId,
          type: "general_win",
          title: "Elected — President of the United States",
          message: winMessage,
          metadata: {
            electionId: election._id.toString(),
            electionType: "president",
            resolutionMode,
            ...(isContingent && {
              tiedEv: tiedEv || undefined,
              houseDelegationVotes: contingentResult?.houseVoteTotals[winnerId],
            }),
          },
        },
      ]);
      try {
        const { resolveUserIdFromCharacter } = await import("@/lib/achievements");
        const { checkElectionWinAchievements, checkOfficeHeldAchievements } =
          await import("@/lib/achievements/triggers");
        const winnerUserId = await resolveUserIdFromCharacter(winnerCandidate.characterId);
        if (winnerUserId) {
          await checkElectionWinAchievements(
            winnerUserId,
            winnerCandidate.characterId,
            "president"
          );
          await checkOfficeHeldAchievements(winnerUserId, winnerCandidate.characterId, "president");
        }
      } catch (e) {
        console.error("Achievement check failed:", e);
      }
    }
  }

  if (vpCharId) {
    const vpCharForNotify = await db
      .collection<Character>("characters")
      .findOne({ _id: vpCharId }, { projection: { userId: 1 } });
    if (vpCharForNotify?.userId) {
      const isContingentVp =
        resolutionMode === "contingent" || resolutionMode === "contingent_deadlock";
      await createNotifications([
        {
          userId: vpCharForNotify.userId,
          type: "general_win",
          title: "Elected — Vice President of the United States",
          message: isContingentVp
            ? "Congratulations! The Senate chose you as Vice President in the contingent election."
            : "Congratulations! You were elected Vice President of the United States.",
          metadata: {
            electionId: election._id.toString(),
            electionType: "president",
            officeType: "vicePresident",
            resolutionMode,
          },
        },
      ]);
      try {
        const { resolveUserIdFromCharacter } = await import("@/lib/achievements");
        const { checkOfficeHeldAchievements } = await import("@/lib/achievements/triggers");
        const vpUserId = await resolveUserIdFromCharacter(vpCharId);
        if (vpUserId) {
          await checkOfficeHeldAchievements(vpUserId, vpCharId, "vicePresident");
        }
      } catch (e) {
        console.error("VP achievement check failed:", e);
      }
    }
  }

  const lostPresidentOffice: OfficeType = { type: "president" };
  const lostPresidentLabel = getOfficeLabel(lostPresidentOffice, election.countryId);
  const loserNotifInputs: NotificationInput[] = [];

  for (const [candidateId, candidateEv] of ranked.slice(1)) {
    const candidate = candidateMap.get(candidateId);
    if (candidate && !candidate.isNPP && candidate.characterId) {
      await db.collection<Character>("characters").updateOne(
        { _id: candidate.characterId },
        {
          $push: {
            careerHistory: {
              type: "lost_election",
              office: lostPresidentOffice,
              officeLabel: lostPresidentLabel,
              party: candidate.party,
              partyCountryId: election.countryId,
              electionId: election._id.toString(),
              date: now,
            } satisfies CareerEvent,
          },
        }
      );
      const char = await db
        .collection<Character>("characters")
        .findOne({ _id: candidate.characterId }, { projection: { userId: 1 } });
      if (char) {
        const isContingentRace =
          resolutionMode === "contingent" || resolutionMode === "contingent_deadlock";
        const lostHouseBallot =
          isContingentRace &&
          contingentResult?.eligiblePresidentCandidateIds.includes(candidateId) &&
          candidateId !== winnerId;
        const lossMessage = lostHouseBallot
          ? tiedEv > 0 && candidateEv === tiedEv
            ? `The Electoral College tied ${tiedEv}–${tiedEv}. The state-delegation ballot in the House chose another candidate.`
            : `No candidate reached 270 electoral votes. You finished with ${candidateEv} EV but lost the House state-delegation ballot.`
          : "You did not win the presidential election. Better luck next cycle!";
        loserNotifInputs.push({
          userId: char.userId,
          type: "general_loss",
          title: lostHouseBallot
            ? "Election Lost — House Delegation Ballot"
            : "Election Lost — President",
          message: lossMessage,
          metadata: {
            electionId: election._id.toString(),
            electionType: "president",
            resolutionMode,
            candidateEv,
            ...(lostHouseBallot && tiedEv > 0 && { tiedEv }),
          },
        });
      }
    }
  }

  await createNotifications(loserNotifInputs);

  await sendPresidentialElectionWebhook(db, ctx).catch((err) =>
    logger.error("Turn", "Failed to send presidential election webhook", err)
  );
}

async function recordPresidentLeaderChange(db: Db, ctx: PresidentMessagingContext): Promise<void> {
  const {
    election,
    winnerCandidate,
    winnerId,
    winnerEV,
    resolutionMode,
    tiedEv,
    contingentResult,
    now,
  } = ctx;

  const gameState = await (await getGameStateCollection(db)).findOne({ _id: "current" });
  const turn = gameState?.currentTurn ?? 0;
  const isContingentResolution =
    resolutionMode === "contingent" || resolutionMode === "contingent_deadlock";
  const houseDelegationVotes = contingentResult?.houseVoteTotals[winnerId];
  const historyTitle = isContingentResolution
    ? tiedEv > 0
      ? `${winnerCandidate.characterName} sworn in as President (House ballot after ${tiedEv}–${tiedEv} EV tie)`
      : `${winnerCandidate.characterName} sworn in as President (House contingent ballot)`
    : `${winnerCandidate.characterName} sworn in as President`;

  await recordCountryEvent(
    db,
    {
      countryId: election.countryId,
      turn,
      eventType: "leader_change",
      title: historyTitle,
      officeType: "president",
      characterId: winnerCandidate.isNPP ? undefined : winnerCandidate.characterId,
      characterName: winnerCandidate.characterName,
      party: winnerCandidate.party,
      details: {
        electionId: election._id.toString(),
        isNPP: winnerCandidate.isNPP ?? false,
        resolutionMode,
        electoralVotes: winnerEV,
        ...(isContingentResolution &&
          contingentResult && {
            houseDelegationVotes,
            houseVoteTotals: contingentResult.houseVoteTotals,
            senateVoteTotals: contingentResult.senateVoteTotals,
            contingentPresidentWinnerId: contingentResult.presidentWinnerId,
            contingentVicePresidentWinnerId: contingentResult.vicePresidentWinnerId,
            deadlockBreakerUsed: contingentResult.deadlockBreakerUsed,
          }),
      },
    },
    now
  );
}

async function sendPresidentialElectionWebhook(
  db: Db,
  ctx: PresidentMessagingContext
): Promise<void> {
  const {
    ranked,
    candidateMap,
    winnerId,
    winnerCandidate,
    winnerEV,
    resolutionMode,
    tiedEv,
    contingentResult,
    now,
  } = ctx;

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({})
    .project<Pick<PoliticalParty, "_id" | "countryId" | "sequentialId" | "name" | "color">>({
      countryId: 1,
      sequentialId: 1,
      name: 1,
      color: 1,
    })
    .toArray();
  const partyMap = new Map(parties.map((p) => [`${p.countryId}:${p.sequentialId}`, p]));
  const winnerParty = partyMap.get(`US:${winnerCandidate.party}`);

  const resultsLines: string[] = [];
  for (const [candidateId, evCount] of ranked) {
    const candidate = candidateMap.get(candidateId);
    if (!candidate) continue;
    const isWinner = candidateId === winnerId;
    const playerMark = !candidate.isNPP ? " :star:" : "";
    const winnerMark = isWinner ? " :trophy:" : "";
    const party = partyMap.get(`US:${candidate.party}`);
    const partyName = party?.name ?? candidate.party ?? "Independent";
    resultsLines.push(
      `${winnerMark}**${candidate.characterName}** (${partyName})${playerMark} — ${evCount} EV`
    );
  }

  const isContingent = resolutionMode === "contingent" || resolutionMode === "contingent_deadlock";
  const houseVotes = contingentResult?.houseVoteTotals[winnerId] ?? 0;
  const title = isContingent
    ? tiedEv > 0
      ? `Presidential Election — ${tiedEv}–${tiedEv} EV Tie (Delegation Ballot)`
      : "Presidential Election — No EV Majority (Delegation Ballot)"
    : "Presidential Election Results";
  const winnerField = isContingent
    ? `**${winnerCandidate.characterName}** — ${houseVotes} state delegation vote(s) (${winnerEV} EV)`
    : `**${winnerCandidate.characterName}** with ${winnerEV} electoral votes`;
  const footerText = isContingent
    ? contingentResult?.deadlockBreakerUsed
      ? `House/Senate contingent ballot. Deadlock breaker applied. 270 EV needed for outright victory.`
      : "Resolved by House state-delegation ballot (26 states). 270 EV needed for outright victory."
    : "270 electoral votes needed to win";

  const vpNameById = new Map<string, string>();
  for (const candidate of candidateMap.values()) {
    if (candidate.runningMateId) {
      const rmChar = await db
        .collection<Character>("characters")
        .findOne({ _id: candidate.runningMateId }, { projection: { name: 1 } });
      if (rmChar) vpNameById.set(candidate.runningMateId.toString(), rmChar.name);
    }
  }
  const contingentVpIds = contingentResult
    ? Object.keys(contingentResult.senateVoteTotals).filter((id) => !vpNameById.has(id))
    : [];
  if (contingentVpIds.length > 0) {
    const charVpIds = contingentVpIds.filter((id) => !isNppContingentId(id));
    const nppVpIds = contingentVpIds.filter(isNppContingentId).map((id) => id.slice(4));
    const [vpChars, vpNpps] = await Promise.all([
      charVpIds.length > 0
        ? db
            .collection<Character>("characters")
            .find({ _id: { $in: charVpIds.map((id) => new ObjectId(id)) } })
            .project({ _id: 1, name: 1 })
            .toArray()
        : [],
      nppVpIds.length > 0
        ? db
            .collection<NPP>("npps")
            .find({ _id: { $in: nppVpIds.map((id) => new ObjectId(id)) } })
            .project({ _id: 1, name: 1 })
            .toArray()
        : [],
    ]);
    for (const c of vpChars) vpNameById.set(c._id.toString(), c.name);
    for (const n of vpNpps) vpNameById.set(`npp_${n._id.toString()}`, n.name);
  }

  const embed: DiscordEmbed = {
    title,
    description: resultsLines.join("\n"),
    color: winnerParty?.color
      ? parseInt(winnerParty.color.replace("#", ""), 16)
      : DISCORD_COLORS.electionResult,
    fields: [
      { name: "Winner", value: winnerField, inline: false },
      ...(isContingent && contingentResult
        ? [
            {
              name: "House delegation votes",
              value: Object.entries(contingentResult.houseVoteTotals)
                .sort((a, b) => b[1] - a[1])
                .map(([id, votes]) => {
                  const name = candidateMap.get(id)?.characterName ?? id;
                  return `**${name}** — ${votes} state(s)`;
                })
                .join("\n"),
              inline: true,
            },
            ...(Object.keys(contingentResult.senateVoteTotals).length > 0
              ? [
                  {
                    name: "Senate VP votes",
                    value: Object.entries(contingentResult.senateVoteTotals)
                      .sort((a, b) => b[1] - a[1])
                      .map(([vpId, votes]) => {
                        const name = vpNameById.get(vpId) ?? vpId;
                        return `**${name}** — ${votes} senator(s)`;
                      })
                      .join("\n"),
                    inline: true,
                  },
                ]
              : []),
          ]
        : []),
    ],
    footer: { text: footerText },
    timestamp: now.toISOString(),
  };

  await sendCountryGameEvent("US", embed);
}

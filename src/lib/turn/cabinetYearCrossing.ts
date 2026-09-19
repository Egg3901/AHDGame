import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import {
  getCabinetCountryIds,
  getCabinetPositions,
  type CabinetPositionDef,
} from "@/lib/constants/cabinetMechanics";
import { isSeatActive, resolveSeatName } from "@/lib/cabinet/rosterEra";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { createSystemNewsPost } from "@/lib/news";
import { sendNewsEvent, DISCORD_COLORS } from "@/lib/discordWebhooks";

export interface CabinetYearCrossingResult {
  ran: boolean;
  /** "UK:agriculture_secretary->environment_secretary" */
  transferred: string[];
  /** "UK:agriculture_secretary" */
  removed: string[];
  /** Titles of news posts made this run. */
  posted: string[];
  /** True when the guard was stamped on first run without posting. */
  healed?: boolean;
}

/**
 * Cabinet year crossing: when the live year advances, unlock newly-established
 * seats (news), rename era-banded seats (news), and retire seats past
 * `yearRetired` (auto-transfer the incumbent to `succeededBy`, else remove).
 *
 * State reconcile ALWAYS runs when year data exists — the roster resolver reads
 * the live year directly, so leaving a member on a retired seat would desync UI
 * and DB. News posting is additionally gated on `eraSystemEnabled` (era-news
 * philosophy, mirrors eraCrossing). Guarded by
 * `gameState.lastCabinetYearProcessed`; the first run quietly self-heals
 * (reconciles retirements silently, stamps, posts nothing) so enabling
 * mid-game never bursts missed news. Seats filled AHEAD of their `yearEnabled`
 * (world year behind the seat) are deliberately untouched — that backward
 * direction belongs to scripts/debug/audit-cabinet-year-seats.mjs.
 *
 * News copy carries no literal years (LARP convention).
 */
export async function runCabinetYearCrossing(db: Db): Promise<CabinetYearCrossingResult> {
  const result: CabinetYearCrossingResult = {
    ran: false,
    transferred: [],
    removed: [],
    posted: [],
  };
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { currentYear: 1, lastCabinetYearProcessed: 1, eraSystemEnabled: 1 } }
    );

  if (!gameState) return result;
  const currentYear = gameState.currentYear;
  if (currentYear === undefined || !Number.isFinite(currentYear)) return result;

  const lastYear = gameState.lastCabinetYearProcessed;
  if (lastYear === undefined || !Number.isFinite(lastYear)) {
    await reconcileRetirements(db, currentYear, result);
    await stampGuard(db, currentYear);
    return { ...result, ran: true, healed: true };
  }
  if (currentYear <= lastYear) return result;

  const postNews = !!gameState.eraSystemEnabled;

  for (const countryId of getCabinetCountryIds()) {
    const countryName = COUNTRY_CONFIGS[countryId as CountryId]?.name ?? countryId;
    const positions = getCabinetPositions(countryId);
    // Successor seats of positions retiring in THIS crossing: their unlock is
    // announced by the reorganization item, never as a separate "Established".
    const successionTargets = new Set(
      positions
        .filter(
          (p) =>
            p.succeededBy !== undefined &&
            isSeatActive(p, lastYear) &&
            !isSeatActive(p, currentYear)
        )
        .map((p) => p.succeededBy as string)
    );
    for (const position of positions) {
      const wasActive = isSeatActive(position, lastYear);
      const nowActive = isSeatActive(position, currentYear);

      if (!wasActive && nowActive) {
        if (postNews && !successionTargets.has(position.id)) {
          const name = resolveSeatName(position, currentYear);
          await postCrossingNews(result, {
            title: `${name} Established`,
            body: `${countryName}'s government has established the office of ${name}. The post stands vacant, awaiting its first appointment.`,
          });
        }
      } else if (wasActive && !nowActive) {
        await retireSeat(db, countryId, position, currentYear, postNews, countryName, result);
      } else if (wasActive && nowActive) {
        const oldName = resolveSeatName(position, lastYear);
        const newName = resolveSeatName(position, currentYear);
        if (oldName !== newName && postNews) {
          await postCrossingNews(result, {
            title: "Machinery of Government Changes",
            body: `${countryName}'s office of ${oldName} is henceforth styled ${newName}.`,
          });
        }
      }
    }
  }

  await stampGuard(db, currentYear);
  return { ...result, ran: true };
}

async function retireSeat(
  db: Db,
  countryId: string,
  position: CabinetPositionDef,
  currentYear: number,
  postNews: boolean,
  countryName: string,
  result: CabinetYearCrossingResult
): Promise<void> {
  const members = getCabinetMembersCollection(db);
  const incumbent = await members.findOne({
    countryId: countryId as CountryId,
    positionId: position.id,
  });
  const successor = position.succeededBy
    ? getCabinetPositions(countryId).find((p) => p.id === position.succeededBy)
    : undefined;

  let transferredIncumbent = false;
  if (incumbent && successor) {
    const successorTaken = await members.findOne({
      countryId: countryId as CountryId,
      positionId: successor.id,
    });
    if (!successorTaken) {
      await members.updateOne(
        { _id: incumbent._id },
        { $set: { positionId: successor.id, updatedAt: new Date() } }
      );
      result.transferred.push(`${countryId}:${position.id}->${successor.id}`);
      transferredIncumbent = true;
    }
  }
  if (incumbent && !transferredIncumbent) {
    await members.deleteOne({ _id: incumbent._id });
    result.removed.push(`${countryId}:${position.id}`);
  }

  if (postNews) {
    const oldName = resolveSeatName(position, currentYear - 1);
    if (successor) {
      const newName = resolveSeatName(successor, currentYear);
      const continuation = transferredIncumbent ? " The sitting minister continues in office." : "";
      await postCrossingNews(result, {
        title: `${newName} Established`,
        body: `${countryName}'s portfolio of ${oldName} has been reorganized as ${newName}.${continuation}`,
      });
    } else {
      await postCrossingNews(result, {
        title: "Machinery of Government Changes",
        body: `${countryName}'s office of ${oldName} has been abolished.`,
      });
    }
  }
}

/** Silent pass used by the first-run self-heal: fix any occupied retired seat. */
async function reconcileRetirements(
  db: Db,
  currentYear: number,
  result: CabinetYearCrossingResult
): Promise<void> {
  for (const countryId of getCabinetCountryIds()) {
    const countryName = COUNTRY_CONFIGS[countryId as CountryId]?.name ?? countryId;
    for (const position of getCabinetPositions(countryId)) {
      if (position.yearRetired !== undefined && currentYear >= position.yearRetired) {
        await retireSeat(db, countryId, position, currentYear, false, countryName, result);
      }
    }
  }
}

async function stampGuard(db: Db, currentYear: number): Promise<void> {
  await db
    .collection<GameState>("gameState")
    .updateOne(
      { _id: "current" },
      { $set: { lastCabinetYearProcessed: currentYear, updatedAt: new Date() } }
    );
}

async function postCrossingNews(
  result: CabinetYearCrossingResult,
  news: { title: string; body: string }
): Promise<void> {
  await createSystemNewsPost(news.body, "general", { title: news.title });
  await sendNewsEvent({
    title: news.title,
    description: news.body,
    color: DISCORD_COLORS.worldMilestone,
  });
  result.posted.push(news.title);
}

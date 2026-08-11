/**
 * Seed script: create task-hunt tasks
 * Run with: npx tsx scripts/seeds/tasks.ts
 */
import { ObjectId } from "mongodb";
import { connectDb, closeDb } from "../utils/db";

const SYSTEM_CREATED_BY = new ObjectId("000000000000000000000001");

const tasks = [
  // Critical bugs
  {
    title: "PM succession stub after no-confidence vote",
    description:
      "When a no-confidence vote passes, there is no implementation for PM succession. The `handleNoConfidence` function is a stub that does not trigger government formation or select a new PM. Government is left in a broken state.",
    type: "bug",
    priority: "critical",
  },
  {
    title: "getPartyPosition() returns hardcoded zeroes",
    description:
      "The `getPartyPosition()` helper in `src/lib/utils/demographics.ts` returns hardcoded 0s for all party positions instead of reading from party records. This causes incorrect demographic turnout calculations — all voter groups behave as if every party is perfectly centrist.",
    type: "bug",
    priority: "critical",
  },
  {
    title: "getCanvassingActionsForTurn() is an empty stub",
    description:
      "The `getCanvassingActionsForTurn()` function returns an empty array, meaning no canvassing actions are ever processed during turn calculations. Demographic mobilization is effectively disabled. This is a core mechanic that needs to be implemented.",
    type: "bug",
    priority: "critical",
  },

  // High
  {
    title: "Cabinet does not resign on government transition",
    description:
      "When a new PM is formed or a government falls, cabinet ministers should resign. Currently cabinet members persist through government transitions. This leaves stale cabinet entries after a new government forms.",
    type: "feature",
    priority: "high",
  },
  {
    title: "Leadership election results have no governance effects",
    description:
      "When a new party leader wins a leadership election, their policy positions and attributes should influence the party's behavior and effectiveness. Currently no effects are applied — the party operates identically regardless of who leads it.",
    type: "feature",
    priority: "high",
  },
  {
    title: "Implement wiki system rebuild",
    description:
      "The wiki system was redesigned (see `docs/plans/`) but the rebuild has not been implemented. The new design includes template-based page generation, auto-population from game data, versioned edit history, and improved search. Current wiki is a placeholder.",
    type: "improvement",
    priority: "high",
  },
  {
    title: "Discord webhook integration for game events",
    description:
      "Add Discord webhook integration to broadcast key game events: election results, legislation passing, government formation/collapse, leadership election results. Webhook URL should be configurable via admin settings.",
    type: "feature",
    priority: "high",
  },

  // Medium
  {
    title: "Country map components show placeholder instead of map",
    description:
      "The country map components on state/region pages display a static placeholder. Implement SVG-based interactive maps for US states, UK constituencies, Canadian provinces, and German Länder showing election results and demographic data.",
    type: "improvement",
    priority: "medium",
  },
  {
    title: "isPrimeMinister check uses hardcoded string comparison",
    description:
      "The `isPrimeMinister` check in character logic uses a hardcoded string rather than checking the character's current office against the PM office type from country config. Will break if office key naming ever changes.",
    type: "bug",
    priority: "medium",
  },
  {
    title: "No notifications sent for no-confidence vote events",
    description:
      "When a no-confidence vote is triggered or passed, affected characters (PM, cabinet ministers, party leaders) receive no in-game notifications. Players have no way to know the vote happened unless they check the government page.",
    type: "feature",
    priority: "medium",
  },
  {
    title: "Bill amendments feature is an unimplemented stub",
    description:
      "The bill amendments feature is referenced in the state bills UI but the API endpoints and processing logic are not implemented. The `applyAmendments()` call in turn processing does nothing. Players cannot propose or vote on bill amendments.",
    type: "feature",
    priority: "medium",
  },

  // Low
  {
    title: "Resolve wiki seed file TODO comments",
    description:
      "The wiki seed files in `scripts/seeds/` contain multiple TODO comments for unimplemented page types, missing content sections, and placeholder categories. These need to be addressed as part of the wiki rebuild.",
    type: "improvement",
    priority: "low",
  },
  {
    title: "Add test coverage for presidential election engine",
    description:
      "The presidential election engine (`src/lib/presidentialElectionEngine.ts`), canvassing action processing, and party position calculations lack unit tests. Add tests before modifying these systems to prevent regressions.",
    type: "improvement",
    priority: "low",
  },
];

async function run() {
  const db = await connectDb();
  const collection = db.collection("tasks");

  const now = new Date();
  const docs = tasks.map((t) => ({
    ...t,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    createdBy: SYSTEM_CREATED_BY,
  }));

  const result = await collection.insertMany(docs);
  console.log(`Inserted ${result.insertedCount} tasks`);

  await closeDb();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

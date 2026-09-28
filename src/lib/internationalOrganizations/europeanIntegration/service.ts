/**
 * European institutional state is initialized once, preserving existing unions
 * and member choices. Seed replay never resets a ratification or settlement.
 */
import type { Db } from "mongodb";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import type { GameState } from "@/lib/db/types/gameState";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { calendarTurn, turnToGameMonth } from "@/lib/utils/gameDate";
import {
  initialEuropeanIntegration,
  recordEuropeanRatification,
  reconcileEuropeanTreaty,
  type EuropeanIntegrationState,
} from "./rules";

export async function ensureEuropeanIntegrationState(
  db: Db,
  preset: string,
  hasEuropeanMembers: boolean
): Promise<EuropeanIntegrationState> {
  const states = db.collection<GameState>("gameState");
  const state = await states.findOne(
    { _id: "current" },
    { projection: { currentTurn: 1, europeanIntegration: 1 } }
  );
  if (state?.europeanIntegration) return state.europeanIntegration;
  const initial = initialEuropeanIntegration({
    startingYear: getStartingYearForPreset(preset),
    currentTurn: state ? (state.currentTurn ?? 2) : 0,
    hasEuropeanMembers,
  });
  if (!state) return initial;
  const result = await states.updateOne(
    { _id: "current", europeanIntegration: { $exists: false } },
    { $set: { europeanIntegration: initial } }
  );
  if (result.matchedCount === 1) return initial;
  const latest = await states.findOne(
    { _id: "current" },
    { projection: { europeanIntegration: 1 } }
  );
  if (!latest?.europeanIntegration)
    throw new Error("European institutional state changed concurrently; retry");
  return latest.europeanIntegration;
}

export async function loadEuropeanTreatyContext(db: Db, turn?: number) {
  const [world, memberships] = await Promise.all([
    db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          currentTurn: 1,
          startingYear: 1,
          preset: 1,
          europeanIntegration: 1,
          "preIteration.active": 1,
          preIterationTurns: 1,
        },
      }
    ),
    db
      .collection<{ countryId: string; joinedTurn?: number }>("organizationMemberships")
      .find({ organizationId: "EU" }, { projection: { countryId: 1, joinedTurn: 1 } })
      .toArray(),
  ]);
  if (!world) return null;
  const preset = world.preset ?? DEFAULT_SEED_PRESET;
  const members = memberships.map((member) => member.countryId);
  const membershipIds = Object.fromEntries(
    memberships.map((member) => [
      member.countryId,
      member._id?.toString() ?? `legacy:${member.countryId}:${member.joinedTurn ?? 0}`,
    ])
  );
  const state =
    world.europeanIntegration ??
    (await ensureEuropeanIntegrationState(db, preset, members.length > 0));
  const rawTurn = turn ?? world.currentTurn;
  const calendar = calendarTurn(rawTurn, {
    preIterationActive: world.preIteration?.active,
    preIterationTurns: world.preIterationTurns,
  });
  const { year, month } = turnToGameMonth(
    calendar,
    world.startingYear ?? getStartingYearForPreset(preset)
  );
  const day = ((calendar - 1) % 4) * 7 + 1;
  const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { state, members, membershipIds, date, turn: rawTurn };
}

async function mutateEuropeanState(
  db: Db,
  turn: number,
  decide: (
    context: NonNullable<Awaited<ReturnType<typeof loadEuropeanTreatyContext>>>
  ) => EuropeanIntegrationState
): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const context = await loadEuropeanTreatyContext(db, turn);
    if (!context) return false;
    const next = decide(context);
    if (next === context.state) return false;
    const result = await db.collection<GameState>("gameState").updateOne(
      {
        _id: "current",
        "europeanIntegration.revision": context.state.revision ?? { $exists: false },
      },
      { $set: { europeanIntegration: { ...next, revision: (context.state.revision ?? 0) + 1 } } }
    );
    if (result.matchedCount === 1) return true;
  }
  throw new Error("European ratification changed concurrently; retry");
}

export async function recordEnactedMaastricht(
  db: Db,
  countryId: string,
  approved: boolean,
  billId: string,
  turn: number
): Promise<void> {
  await mutateEuropeanState(db, turn, (context) =>
    recordEuropeanRatification({
      ...context,
      countryId,
      decision: {
        approved,
        decisionId: billId,
        turn,
        membershipId: context.membershipIds[countryId],
      },
    })
  );
}

export async function reconcileEuropeanTreatyLive(db: Db, turn: number): Promise<boolean> {
  return mutateEuropeanState(db, turn, (context) => reconcileEuropeanTreaty(context));
}

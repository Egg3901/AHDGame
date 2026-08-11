/**
 * Command Economy v2 (P2) — shared setup for the role write endpoints.
 *
 * Resolves the authenticated character, confirms the country is a flag-on
 * planned economy with the command-economy offices defined, and loads the
 * caller's seats. Each write route then checks the specific seat it needs
 * (`canOperateGosbank` / `canOperateGosplan` / director) before mutating.
 */

import { NextResponse } from "next/server";
import type { Db, ObjectId } from "mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { forbidden, notFound } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { commandEconomyOffices } from "@/lib/constants/commandEconomyOffices";
import { isPlannedEconomy, scheduledMarketizationLevel } from "@/lib/constants/commandEconomy";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { GameConfig } from "@/lib/db/types";
import {
  resolveCommandEconomyRoles,
  type CommandEconomyRoles,
} from "@/lib/economy/commandEconomyAuth";

export interface CommandEconomyWriteContext {
  db: Db;
  countryId: CountryId;
  characterId: ObjectId;
  characterName: string;
  roles: CommandEconomyRoles;
  currentTurn: number;
  marketizationLevel: number;
}

export type WriteContextResult =
  { ok: true; ctx: CommandEconomyWriteContext } | { ok: false; response: NextResponse };

/**
 * Common gate for every command-economy write route. Fails closed:
 *  - 401 if unauthenticated / no character (via requireAuthWithCharacter)
 *  - 404 if the country is unknown or not a flag-on command country
 */
export async function resolveWriteContext(code: string): Promise<WriteContextResult> {
  const auth = await requireAuthWithCharacter();
  if (!auth.ok) return { ok: false, response: auth.response };

  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId] || !commandEconomyOffices(countryId)) {
    return {
      ok: false,
      response: NextResponse.json(notFound("Country not found").toJson(), { status: 404 }),
    };
  }

  const db = await getDb();
  const [gameConfig, gameState] = await Promise.all([
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
    getGameState(),
  ]);
  const enabled = gameConfig?.commandEconomyEnabled === true;
  const currentYear = gameState?.currentYear ?? null;
  if (!enabled || !isPlannedEconomy(countryId, currentYear, enabled)) {
    return {
      ok: false,
      response: NextResponse.json(
        notFound("This country does not run a command economy.").toJson(),
        { status: 404 }
      ),
    };
  }

  const character = auth.user.character;
  const characterId = character._id;
  // A player can only drive a seat in their OWN country.
  if (character.countryId && character.countryId !== countryId) {
    return {
      ok: false,
      response: NextResponse.json(
        forbidden("You can only act on your own country's economy.").toJson(),
        { status: 403 }
      ),
    };
  }

  const [roles, budget] = await Promise.all([
    resolveCommandEconomyRoles(db, countryId, characterId),
    db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: getNationalBudgetId(countryId) } as { _id: "federal" }, {
        projection: { "economicFactors.marketizationLevel": 1 },
      }),
  ]);

  const persisted = budget?.economicFactors?.marketizationLevel;
  const marketizationLevel =
    typeof persisted === "number" && Number.isFinite(persisted)
      ? persisted
      : scheduledMarketizationLevel(countryId, currentYear);

  return {
    ok: true,
    ctx: {
      db,
      countryId,
      characterId,
      characterName: character.name ?? "Official",
      roles,
      currentTurn: gameState?.currentTurn ?? 0,
      marketizationLevel,
    },
  };
}

/**
 * GET /api/game/countries
 *
 * Returns the list of country IDs that are currently enabled for players,
 * along with registered player counts and game state info for the
 * character creation screen.
 */
import { NextResponse } from "next/server";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { COUNTRY_CONFIGS, getCountryDisplayName } from "@/lib/constants/countries";
import { resolveCountryIdentities } from "@/lib/country/countryIdentity";
import { getCountryFlagUrlForEra } from "@/lib/constants/flags";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { calendarTurn } from "@/lib/utils/gameDate";
import type { CountryCreationInfo } from "@/lib/registration/types";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

export type { CountryCreationInfo };

// ── Preset flavor text ──────────────────────────────────────────────

export const PRESET_CHARACTER_CREATION_FLAVOR: Record<string, string> = {
  "1953-default":
    "Stalin is dead. It is 1953, and the world holds its breath. The Korean War has just ended in an uneasy armistice. The Soviet Union, its fearsome dictator gone only months ago, is an empire in search of a new master, as Khrushchev, Beria, and Malenkov claw for power in the Kremlin. In Washington, Eisenhower has inherited a nuclear standoff and a Red Scare at home, where McCarthy hunts communists in every shadow. The Iron Curtain is drawn tight: East Germany, fresh from the June 17 uprising, is under Soviet jackboots. Britain is still rationing food. France is bleeding in Indochina. West Germany, not yet a decade from rubble, is rebuilding under Adenauer. The postwar boom is just beginning to promise abundance to the West while the East counts its dead. The hydrogen bomb has been tested; television is entering the living room; the colonial world is beginning to stir. History is accelerating, and the next move is yours.",
  "1979-default":
    "It is 1979, and the Cold War divides the world. Two superpowers - the United States under a faltering Carter presidency and the Soviet Union under an aging Brezhnev - hold the balance of nuclear terror. The Iron Curtain splits Europe: a prosperous West and the Warsaw-Pact East, with Germany itself cut in two. Détente is fraying as Soviet tanks mass near Afghanistan. In Britain, Margaret Thatcher has just taken power; across the Mediterranean, young democracies in Spain and Portugal find their footing while Italy bleeds through the Years of Lead. Stagflation and the oil shock grip the capitalist economies; the planned economies of the East stagnate behind their walls. The personal computer, the silicon revolution, and a wave of upheaval are just over the horizon.",
  "1991-default":
    "The Cold War has just ended. The Berlin Wall fell two years ago, the Soviet Union is crumbling, and a new world order is taking shape. In the United States, a victorious George H. W. Bush sits in the White House after the Gulf War. The internet is in its infancy. Hip-hop and grunge define the cultural moment. In the UK, John Major has replaced Margaret Thatcher. Germany is newly reunified. Japan's bubble economy has just burst. China is emerging from the shadow of Tiananmen. The world is full of uncertainty and opportunity.",
  "2019-default":
    "The world is on the brink of the 2020s. The Trump presidency has reshaped American politics, Brexit deadlock grips the UK, and Europe grapples with migration and rising populism. Japan's Reiwa era has just begun under Emperor Naruhito. China's rise continues under Xi Jinping's consolidation of power. Social media dominates the political conversation, and the climate crisis looms larger every year. The old certainties are gone, and every nation is charting its own course through turbulent times.",
};

function getFlavorText(preset: string): string {
  return (
    PRESET_CHARACTER_CREATION_FLAVOR[preset] ??
    PRESET_CHARACTER_CREATION_FLAVOR["2019-default"] ??
    ""
  );
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function turnToDate(startingYear: number, turn: number): { month: string; year: number } {
  const yearOffset = Math.floor(Math.max(0, turn - 1) / 48);
  const monthIndex = Math.max(0, turn - 1) % 48;
  const month = Math.min(11, Math.floor(monthIndex / 4));
  return { month: MONTHS[month], year: startingYear + yearOffset };
}

function formatDate(startingYear: number, turn: number): string {
  const d = turnToDate(startingYear, turn);
  return `${d.month} ${d.year}`;
}

// ── Handler ────────────────────────────────────────────────────────

// GET /api/game/countries — Returns enabled country IDs + player counts + game state for character creation.
// Auth: public
export async function GET() {
  try {
    const [db, enabledIds] = await Promise.all([getDb(), getEnabledCountryIds()]);

    const enabledSet = new Set(enabledIds.map((id) => id.toUpperCase()));

    // Get active player count per country (characters tied to non-retired users)
    const playerCountsByCountry: Record<string, number> = {};
    const players = await db
      .collection("characters")
      .aggregate([
        { $match: { retiredAt: { $exists: false } } },
        { $group: { _id: "$countryId", count: { $sum: 1 } } },
      ])
      .toArray();
    for (const row of players) {
      playerCountsByCountry[row._id ?? "US"] = row.count;
    }

    // Game state — fetched first so country names honor the era (e.g. the FRG
    // shows as "West Germany" in 1979 while the GDR exists).
    const gameState = await getGameState();
    const preset = gameState?.preset ?? DEFAULT_SEED_PRESET;

    // Runtime identity: a country unified or converted at runtime must not be
    // offered under the name and system it no longer has.
    const eligible = Object.values(COUNTRY_CONFIGS).filter((cfg) => enabledSet.has(cfg.id));
    const identities = await resolveCountryIdentities(
      await getDb(),
      eligible.map((cfg) => cfg.id),
      preset
    );
    const countries: CountryCreationInfo[] = eligible.map((cfg) => {
      const identity = identities.get(cfg.id);
      return {
        id: cfg.id.toLowerCase(),
        name: identity?.name ?? getCountryDisplayName(cfg.id, preset),
        flagUrl: getCountryFlagUrlForEra(cfg.code, preset),
        desc: identity?.governmentTypeLabel ?? cfg.governmentTypeLabel,
        playerCount: playerCountsByCountry[cfg.id] ?? 0,
        governmentType: identity?.governmentType ?? cfg.governmentType,
      };
    });

    const startingYear = gameState?.startingYear ?? getStartingYearForPreset(preset);
    // Display date must go through the pre-iteration clock, exactly as the
    // in-app status bar does. Reading the raw turn counter here is what put the
    // creation dateline a founding-cycle ahead of the clock every other surface
    // shows (a 48-turn founding cycle rendered as a whole extra year).
    const currentTurn = calendarTurn(gameState?.currentTurn ?? 1, {
      preIterationActive: gameState?.preIteration?.active,
      preIterationTurns: gameState?.preIterationTurns,
    });
    const currentDateText = formatDate(startingYear, currentTurn);
    const startDateText = formatDate(startingYear, 1); // Turn 1 = world start
    const flavorText = getFlavorText(preset);

    return NextResponse.json(
      {
        countries,
        gameDate: currentDateText,
        startDate: startDateText,
        flavorText,
        // The flavour text is written in the present tense of the world's FIRST
        // turn, not of now. Ship the date it describes so the client can label
        // it as the opening scene instead of passing it off as today's news.
        flavorDate: startDateText,
        preset,
      },
      {
        // Global signup/country-picker data (no per-user fields); cache at the
        // edge like the sibling reference routes instead of recomputing the
        // full-collection player-count aggregation on every request. (#2818)
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

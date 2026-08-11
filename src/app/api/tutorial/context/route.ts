import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import type {
  Corporation,
  Election,
  GameConfig,
  PoliticalParty,
  State,
  StateMetrics,
  Union,
} from "@/lib/db/types";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { regionNoun } from "@/lib/onboarding/checklist";
import type { TutorialFacts } from "@/lib/tutorial/facts";

/**
 * GET /api/tutorial/context — live world numbers for the tutorial coach.
 *
 * A coach step names the fact keys it wants; the values come from here already
 * formatted for display, so currency and percentage formatting stays on the
 * server and the coach stays a dumb renderer. Anything that cannot be computed
 * (an unseeded country, a missing metrics row) is simply left out, and the card
 * renders without it.
 *
 * This is read-only and cheap: counts with a projection, one game-state read.
 */

const compact = (n: number): string =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** "one turn per hour" / "one turn every 30 minutes" / "one turn every 2 hours". */
function turnCadence(minutes: number): string {
  if (minutes === 60) return "one turn per hour";
  if (minutes % 60 === 0) return `one turn every ${minutes / 60} hours`;
  return `one turn every ${minutes} minutes`;
}

export async function GET() {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const { character } = auth.user;

    const countryId = character.countryId as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    const countryName = config?.name ?? "your country";
    const region = regionNoun(countryId);

    const db = await getDb();
    const [gameState, gameConfig, state, metrics, partyCount, openRaces, corps, unions] =
      await Promise.all([
        getGameState(db),
        db
          .collection<GameConfig>("gameConfig")
          .findOne({ _id: "default" }, { projection: { turnLengthMinutes: 1 } }),
        db
          .collection<State>("states")
          .findOne(
            { _id: character.homeState, countryId },
            { projection: { name: 1, population: 1 } }
          ),
        // Unemployment lives on macroMetrics, keyed by region id.
        db
          .collection<StateMetrics>("macroMetrics")
          .findOne(
            { _id: character.homeState },
            { projection: { "economic.unemploymentRate.value": 1 } }
          ),
        // The collection is "politicalParties", not "parties" (seedManifest.ts).
        db.collection<PoliticalParty>("politicalParties").countDocuments({ countryId }),
        db.collection<Election>("elections").countDocuments({
          countryId,
          state: character.homeState,
          status: { $in: ["upcoming", "active"] },
        }),
        Promise.all([
          db.collection<Corporation>("corporations").countDocuments({ countryId }),
          db.collection<Corporation>("corporations").countDocuments({ countryId, ceoVacant: true }),
        ]),
        Promise.all([
          db.collection<Union>("unions").countDocuments({ countryId }),
          db.collection<Union>("unions").countDocuments({ countryId, ownerId: null }),
        ]),
      ]);

    const facts: TutorialFacts = {};

    if (gameState?.currentTurn) {
      facts.turn = {
        label: "Right now",
        value: `Turn ${gameState.currentTurn.toLocaleString()}, ${turnCadence(
          gameConfig?.turnLengthMinutes ?? 60
        )}`,
      };
    }

    if (state?.name) {
      facts.region = { label: `Your home ${region}`, value: state.name };
    }

    const unemployment = metrics?.economic?.unemploymentRate?.value;
    if (state && (typeof unemployment === "number" || typeof state.population === "number")) {
      const parts = [
        typeof unemployment === "number" ? `${unemployment.toFixed(1)}% unemployment` : null,
        typeof state.population === "number" ? `${compact(state.population)} people` : null,
      ].filter(Boolean);
      facts.regionEconomy = { label: state.name ?? "Local economy", value: parts.join(" · ") };
    }

    const funds = character.funds ?? 0;
    facts.wallet = {
      label: "You have",
      value: `₳${Math.round(funds).toLocaleString()} · ${character.actions ?? 0} actions`,
    };

    if (partyCount > 0) {
      facts.parties = {
        label: `Parties in ${countryName}`,
        value: `${partyCount} to choose from`,
      };
    }

    facts.openSeats = {
      label: state?.name ? `Races in ${state.name}` : "Races near you",
      value: openRaces > 0 ? `${openRaces} open right now` : "None open right now",
    };

    const [corpTotal, corpVacant] = corps;
    if (corpTotal > 0) {
      facts.companies = {
        label: `Companies in ${countryName}`,
        value:
          corpVacant > 0
            ? `${corpTotal} listed · ${corpVacant} with no CEO`
            : `${corpTotal} listed · none without a CEO`,
      };
    }

    const [unionTotal, unionVacant] = unions;
    if (unionTotal > 0) {
      facts.unions = {
        label: `Unions in ${countryName}`,
        value:
          unionVacant > 0
            ? `${unionTotal} organized · ${unionVacant} with no leader`
            : `${unionTotal} organized · all led`,
      };
    }

    return NextResponse.json(facts);
  } catch (error) {
    return handleRouteError(error);
  }
}

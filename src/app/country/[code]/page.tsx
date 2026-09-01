import { type Metadata } from "next";
import { notFound } from "next/navigation";
import { getCountryAccess } from "@/lib/countryAccess";
import { resolveCountryAvailability } from "@/lib/countryAvailability";
import { COUNTRY_CONFIGS, getCountryDisplayName, type CountryId } from "@/lib/constants/countries";
import { resolveCountryIdentity } from "@/lib/country/countryIdentity";
import { getGameState } from "@/lib/gameState";
import { getDb } from "@/lib/mongodb";
import type { Election } from "@/lib/db/types";
import CountryOverviewClient from "./CountryOverviewClient";

interface Props {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) return {};
  const gameState = await getGameState();
  // Runtime-aware, for the same reason the layout is: the era alias cannot know
  // the other Germany is gone.
  const identity = await getDb().then((db) =>
    resolveCountryIdentity(db, countryId, gameState?.preset)
  );
  const name = identity.name;
  return {
    title: `${name} | A House Divided`,
    description: config.tagline,
  };
}

export default async function CountryPage({ params }: Props) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) notFound();
  const availability = resolveCountryAvailability(countryId, await getCountryAccess(countryId));

  // Resolved server-side and handed down, because the client cannot read runtime
  // state and the compiled config does not know a country has been unified.
  const pageGameState = await getGameState();
  const identity = await getDb().then((db) =>
    resolveCountryIdentity(db, countryId, pageGameState?.preset)
  );

  let activePresidentElection: { id: string; seatId?: string; status: string } | null = null;
  if (countryId === COUNTRY_CONFIGS.US.id) {
    const db = await getDb();
    const election = await db.collection<Election>("elections").findOne(
      {
        electionType: "president",
        state: "US",
        status: { $in: ["active", "upcoming"] },
      },
      { projection: { _id: 1, seatId: 1, status: 1 } }
    );
    if (election) {
      activePresidentElection = {
        id: election._id.toString(),
        seatId: election.seatId ?? undefined,
        status: election.status,
      };
    }
  }

  return (
    <CountryOverviewClient
      countryId={countryId}
      availability={availability}
      activePresidentElection={activePresidentElection}
      identity={identity}
    />
  );
}

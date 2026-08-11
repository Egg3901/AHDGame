import { Metadata } from "next";
import type { CountryId, CountryStatus } from "@/lib/constants/countries";
import { getAllCountryAccess } from "@/lib/countryAccess";
import { getDb } from "@/lib/mongodb";
import { getGameStateCollection } from "@/lib/db/collections";
import { getNationWorldSnapshots } from "@/lib/world/nationWorldSnapshots";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { getWorldEntityMapSnapshot, type WorldEntityMapSnapshot } from "@/lib/world/worldEntityMap";
import { loadBlocMembership, type BlocMembership } from "@/lib/world/blocMembership";
import WorldClient from "./WorldClient";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

export const metadata: Metadata = publicPageMetadata({
  title: "World | A House Divided",
  description:
    "Choose a country to play in the US, UK, Germany, or Japan. Each country has its own political system, elections, legislature, and economic layer tied to the shared hourly simulation.",
  pathname: "/world",
});

export type CountryAccessMap = Record<
  CountryId,
  {
    enabledForPlayers: boolean;
    status: CountryStatus;
    economyPreview: boolean;
    registered: boolean;
    econOnly: boolean;
  }
>;

export default async function WorldPage() {
  const db = await getDb();
  const [countryAccess, nationSnapshots, gameState] = await Promise.all([
    getAllCountryAccess(),
    getNationWorldSnapshots(db),
    getGameStateCollection(db).then((col) =>
      col.findOne({ _id: "current" }, { projection: { conflictsEnabled: 1, preset: 1 } })
    ),
  ]);
  const preset = gameState?.preset ?? DEFAULT_SEED_PRESET;
  const worldEntities: WorldEntityMapSnapshot = getWorldEntityMapSnapshot(preset);
  // Bloc mode colours the globe from live membership, so the roll has to come
  // down with the page rather than being re-derived from a static table.
  const blocMembership: BlocMembership = await loadBlocMembership(db, preset);
  return (
    <WorldClient
      countryAccess={countryAccess}
      nationSnapshots={nationSnapshots}
      conflictsEnabled={!!gameState?.conflictsEnabled}
      worldEntities={worldEntities}
      blocMembership={blocMembership}
    />
  );
}

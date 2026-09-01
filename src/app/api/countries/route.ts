import { NextResponse } from "next/server";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getAllCountryAccess } from "@/lib/countryAccess";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { resolveCountryIdentities } from "@/lib/country/countryIdentity";

// GET /api/countries — Returns public country configurations for client consumption.
// Auth: public
// Errors: (none)
export async function GET() {
  // getAllCountryAccess already returns the runtime registered set (COUNTRY_ORDER plus
  // any activated latent country), so iterating its keys surfaces a seceded country.
  const accessMap = await getAllCountryAccess();
  const ids = Object.keys(accessMap) as CountryId[];
  // Runtime identity, not the compiled one. A country converted or unified at
  // runtime keeps its compiled name, flag and government-type label for ever, and
  // this listing is where a reader meets all three.
  const db = await getDb();
  const gameState = await getGameState();
  const identities = await resolveCountryIdentities(db, ids, gameState?.preset);
  const countries = ids.map((id) => {
    const c = COUNTRY_CONFIGS[id];
    const access = accessMap[id];
    const identity = identities.get(id);
    return {
      id: c.id,
      name: identity?.name ?? c.name,
      status: access.status,
      enabledForPlayers: access.enabledForPlayers,
      economyPreview: access.economyPreview,
      // Registered but not playable: every page is browsable read-only.
      econOnly: access.econOnly,
      flagEmoji: identity?.flagEmoji ?? c.flagEmoji,
      regionLabel: c.regionLabel,
      regionLabelPlural: c.regionLabelPlural,
      executiveTitle: c.executiveTitle,
      governmentType: identity?.governmentType ?? c.governmentType,
      governmentTypeLabel: identity?.governmentTypeLabel ?? c.governmentTypeLabel,
      exchangeName: c.exchangeName,
      legislature: {
        name: c.legislature.name,
        path: c.legislature.path,
        lowerName: c.legislature.lowerChamber.name,
        upperName: c.legislature.upperChamber?.name ?? "",
      },
      entryPath: c.entryPath,
      overviewPath: c.overviewPath,
      mapPath: c.mapPath,
      executivePath: c.executivePath,
      executiveLabel: c.executiveLabel,
      centralBank: {
        name: c.centralBank.name,
        abbreviation: c.centralBank.abbreviation,
      },
    };
  });

  return NextResponse.json(
    { countries },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60, no-transform",
      },
    }
  );
}

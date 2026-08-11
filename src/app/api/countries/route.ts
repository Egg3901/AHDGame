import { NextResponse } from "next/server";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getAllCountryAccess } from "@/lib/countryAccess";

// GET /api/countries — Returns public country configurations for client consumption.
// Auth: public
// Errors: (none)
export async function GET() {
  // getAllCountryAccess already returns the runtime registered set (COUNTRY_ORDER plus
  // any activated latent country), so iterating its keys surfaces a seceded country.
  const accessMap = await getAllCountryAccess();
  const countries = (Object.keys(accessMap) as CountryId[]).map((id) => {
    const c = COUNTRY_CONFIGS[id];
    const access = accessMap[id];
    return {
      id: c.id,
      name: c.name,
      status: access.status,
      enabledForPlayers: access.enabledForPlayers,
      economyPreview: access.economyPreview,
      // Registered but not playable: every page is browsable read-only.
      econOnly: access.econOnly,
      flagEmoji: c.flagEmoji,
      regionLabel: c.regionLabel,
      regionLabelPlural: c.regionLabelPlural,
      executiveTitle: c.executiveTitle,
      governmentType: c.governmentType,
      governmentTypeLabel: c.governmentTypeLabel,
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

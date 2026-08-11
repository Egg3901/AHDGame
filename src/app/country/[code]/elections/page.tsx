import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getAuthUser } from "@/lib/auth";
import { loadCountryElections } from "@/lib/elections/loadCountryElections";
import ElectionsClient from "./ElectionsClient";

// Server component: loads the elections list (resolved for the viewer) with a
// direct DB call and seeds the client, so the list renders without the old
// shell -> useEffect -> paginated fetch loop. The viewer's character, chamber
// composition and game state stay client-side and hydrate after paint.
export default async function ElectionsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    // Unknown country — let the client render its own empty/guard state.
    return <ElectionsClient code={code} />;
  }

  const user = await getAuthUser();
  const viewer = {
    userId: user?.userId ?? null,
    isAdmin: user?.isAdmin ?? false,
    activeCharacterId: user?.activeCharacterId ?? null,
  };

  // Best-effort: a DB hiccup must not blank the page. On failure the client
  // falls back to its own fetch (initialElections undefined -> skeleton + load).
  const elections = await loadCountryElections(countryId, viewer).catch(() => null);

  if (elections === null) {
    return <ElectionsClient code={code} />;
  }

  return <ElectionsClient code={code} initialElections={elections} />;
}

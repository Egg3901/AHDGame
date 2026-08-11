import { redirect } from "next/navigation";
import { getAuthUserWithCharacter } from "@/lib/auth";

/**
 * Redirect shell: /elections redirects to the player's country elections page.
 * Logged-in players with a character go to their character's country; everyone else defaults to US.
 * Country-specific elections pages live at /country/[code]/elections.
 */
export default async function ElectionsRedirect() {
  const user = await getAuthUserWithCharacter();
  const countryId = user?.character?.countryId ?? "US";
  redirect(`/country/${countryId.toLowerCase()}/elections`);
}

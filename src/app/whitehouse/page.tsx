import { redirect } from "next/navigation";
import { getAuthUserWithCharacter } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Legacy route — redirect to modular executive page.
 */
export default async function WhiteHousePage() {
  const user = await getAuthUserWithCharacter();
  const countryId = user?.character?.countryId ?? "US";
  redirect(`/country/${countryId.toLowerCase()}/executive`);
}

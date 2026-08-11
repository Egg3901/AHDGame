import { redirect } from "next/navigation";
import { getAuthUserWithCharacter } from "@/lib/auth";

// Redirect legacy /budget/federal to player's country budget page
export default async function FederalBudgetRedirect() {
  const user = await getAuthUserWithCharacter();
  const countryId = user?.character?.countryId ?? "US";
  redirect(`/country/${countryId.toLowerCase()}/budget`);
}

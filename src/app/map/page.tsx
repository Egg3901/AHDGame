import { redirect } from "next/navigation";
import { getAuthUserWithCharacter } from "@/lib/auth";

export default async function LegacyMapPage() {
  const user = await getAuthUserWithCharacter();
  const countryId = user?.character?.countryId ?? "US";
  redirect(`/country/${countryId.toLowerCase()}/map`);
}

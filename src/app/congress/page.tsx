import { redirect } from "next/navigation";
import { getAuthUserWithCharacter } from "@/lib/auth";

export default async function CongressPage() {
  const user = await getAuthUserWithCharacter();
  const countryId = user?.character?.countryId ?? "US";
  redirect(`/country/${countryId.toLowerCase()}/legislature`);
}

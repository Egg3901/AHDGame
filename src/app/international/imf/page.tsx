import { redirect } from "next/navigation";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { ImfInternationalPageClient } from "./ImfInternationalPageClient";

export default async function ImfInternationalPage() {
  const user = await getAuthUserWithCharacter();
  if (!user) redirect("/auth/login");
  return <ImfInternationalPageClient />;
}

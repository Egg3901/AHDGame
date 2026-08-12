import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { BankingHubClient } from "./BankingHubClient";

export const dynamic = "force-dynamic";

export default async function BankingHubPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return <BankingHubClient />;
}

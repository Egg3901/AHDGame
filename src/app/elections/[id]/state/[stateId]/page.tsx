import { redirect } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import type { State } from "@/lib/db/types";

export default async function ElectionStateRedirect({
  params,
}: {
  params: Promise<{ id: string; stateId: string }>;
}) {
  const { id, stateId } = await params;
  const upper = stateId.toUpperCase();
  const db = await getDb();
  const state = await db
    .collection<State>("states")
    .findOne({ _id: upper }, { projection: { countryId: 1 } });
  const countryId = state?.countryId ?? "US";
  redirect(`/elections/${id}/country/${countryId.toLowerCase()}/region/${upper}`);
}

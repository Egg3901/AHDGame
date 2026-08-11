import { redirect } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import type { State } from "@/lib/db/types";

export default async function MetricsRedirect({
  params,
}: {
  params: Promise<{ id: string; category: string; metricId: string }>;
}) {
  const { id, category, metricId } = await params;
  const stateId = id.toUpperCase();
  const db = await getDb();
  const state = await db
    .collection<State>("states")
    .findOne({ _id: stateId }, { projection: { countryId: 1 } });
  const countryId = state?.countryId ?? "US";
  redirect(`/country/${countryId.toLowerCase()}/region/${stateId}/metrics/${category}/${metricId}`);
}

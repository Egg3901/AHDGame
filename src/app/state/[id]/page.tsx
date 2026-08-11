import { redirect } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import type { State } from "@/lib/db/types";
import { regionUrl } from "@/lib/urls";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function StateRedirect({ params }: PageProps) {
  const { id } = await params;
  const stateId = id.toUpperCase();
  const db = await getDb();
  const state = await db
    .collection<State>("states")
    .findOne({ _id: stateId }, { projection: { countryId: 1 } });
  const countryId = state?.countryId ?? "US";
  // regionUrl compacts prefixed region ids (HU_BUD → /country/hu/region/BUD).
  redirect(regionUrl(countryId, stateId));
}

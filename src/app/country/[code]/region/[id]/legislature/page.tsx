import { notFound } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import type { State } from "@/lib/db/types";
import { canonicalRegionId, type CountryId } from "@/lib/constants/countries";
import { subNationalChamberSeats } from "@/lib/constants/states";
import { getGameStatePreset } from "@/lib/db/collections/gameState";

import { StateLegislatureClient } from "./StateLegislatureClient";

export default async function StateLegislaturePage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code, id: rawRegionParam } = await params;
  const id = canonicalRegionId(code.toUpperCase(), rawRegionParam);
  const stateId = id.toUpperCase();
  const countryId = code.toUpperCase() as CountryId;
  const db = await getDb();

  const state = await db.collection<State>("states").findOne({
    _id: stateId,
    countryId,
  });

  if (!state) {
    notFound();
  }

  const auth = await getAuthUserWithCharacter();

  return (
    <StateLegislatureClient
      stateId={state._id}
      countryId={code.toUpperCase()}
      stateName={state.name}
      totalSeats={subNationalChamberSeats(countryId, state, await getGameStatePreset(db))}
      isLoggedIn={!!auth}
      characterId={auth?.character?._id.toString()}
      isAdmin={auth?.isAdmin ?? false}
    />
  );
}

/** Country-scoped route plumbing keeps all tender reads and writes within their buying government. */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCountryAccess } from "@/lib/countryAccess";
import { errorResponse, handleRouteError } from "@/lib/api/errors";
import { ContractError } from "./eligibility";
import { tenders } from "./persistence";
export async function contractContext(code: string, id?: string) {
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) throw new ContractError("Unknown country.", 404);
  const access = await getCountryAccess(countryId);
  if (!access.registered) throw new ContractError("Unknown country.", 404);
  const db = await getDb();
  const game = await getGameState(db);
  const turn = game?.currentTurn ?? 1;
  const tender = id
    ? await tenders(db).findOne({ _id: id, countryId, status: { $ne: "publishing" } })
    : null;
  if (id && !tender) throw new ContractError("Contract tender not found.", 404);
  return { db, countryId, turn, tender, game };
}
export function contractRouteError(e: unknown, request: Request) {
  return e instanceof ContractError
    ? errorResponse(e.status, e.message)
    : handleRouteError(e, { request });
}
export function privateJson(body: unknown) {
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}

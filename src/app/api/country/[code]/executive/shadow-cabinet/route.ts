import { NextResponse } from "next/server";
import { COUNTRY_CONFIGS, type CountryId, isParliamentarySystem } from "@/lib/constants/countries";
import {
  appointShadowCabinetHandler,
  clearShadowCabinetHandler,
} from "@/lib/parliament/shadowCabinetApi";

/**
 * Shadow Cabinet appointments (player suggestion #52).
 *
 * POST   — the Leader of the Opposition appoints a character to a shadow post.
 * DELETE — the Leader of the Opposition clears a shadow post.
 *
 * Coarse parliamentary guard here; the finer multiparty guard (and the
 * Opposition Leader authorization) lives in the handlers.
 */

async function resolveParliamentaryCountry(
  params: Promise<{ code: string }>
): Promise<CountryId | null> {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[countryId];
  if (!config || !isParliamentarySystem(config)) return null;
  return countryId;
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const countryId = await resolveParliamentaryCountry(params);
  if (!countryId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return appointShadowCabinetHandler(request, countryId);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const countryId = await resolveParliamentaryCountry(params);
  if (!countryId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return clearShadowCabinetHandler(request, countryId);
}

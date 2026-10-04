// PATCH /api/admin/corporations/[id]/hq
// Moves a corporation's headquarters to a different country/region.
// Body: { countryId: "US"|"UK"|"JP"|"DE", regionId: string }
// Auth: requireAdmin
// Errors: 403, 400, 404
//
// Cross-country moves that cross a currency boundary also convert the corp's
// treasury + sectors + cancel open orders/listings, mirroring the player
// relocate route. Admins bypass cost/CEO-residency gates but not currency
// invariants.

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound, errorResponse } from "@/lib/api/errors";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import {
  convertCorpCurrency,
  type ConvertCorpCurrencySuccess,
} from "@/lib/corporations/convertCorpCurrency";
import type { Character } from "@/lib/db/types/character";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { doesCeoResideAtHeadquarters, vacateCorporationCeo } from "@/lib/corporations/ceoResidency";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import {
  hasProtectedConstructionPropertyIn,
  reserveSectorsForTransition,
  releaseConstructionPropertyTransition,
} from "@/lib/corporations/securedConstructionProperty";

const schema = z.object({
  countryId: z.enum(["US", "UK", "JP", "DE"]),
  regionId: z.string().min(1),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(id) });
    if (!corp) throw notFound("Corporation not found");

    if (corp.primaryUnderwritingIncomingFunding || corp.bankUnderwritingFunding) {
      return errorResponse(
        409,
        "Primary underwriting cash is settling; retry relocation after settlement"
      );
    }

    const propertySectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: corp._id })
      .toArray();
    if (hasProtectedConstructionPropertyIn(propertySectors)) {
      return errorResponse(
        409,
        "Resolve secured construction before relocating corporate headquarters"
      );
    }

    const now = new Date();
    const crossCountry = corp.countryId !== parsed.data.countryId;
    const newCurrency = COUNTRY_CURRENCY_MAP[parsed.data.countryId] as CurrencyCode | undefined;
    const oldCurrency = resolveCorpLiquidCurrencyCode(corp);
    const needsCurrencyConversion =
      crossCountry && newCurrency !== undefined && newCurrency !== oldCurrency;

    let currencyConversion: ConvertCorpCurrencySuccess | null = null;
    if (needsCurrencyConversion && newCurrency) {
      const fxByCurrency = await loadFxRatesByCurrency(db);
      const forexEnabled = await isForexEnabled();
      const convResult = await convertCorpCurrency(
        db,
        corp,
        newCurrency,
        fxByCurrency,
        now,
        forexEnabled,
        propertySectors
      );
      if (!convResult.ok) {
        return NextResponse.json(
          { error: convResult.error },
          { status: convResult.rateUnavailable ? 503 : 400 }
        );
      }
      currencyConversion = convResult;
    }

    const hqTransitionKeys = needsCurrencyConversion
      ? null
      : await reserveSectorsForTransition(
          db,
          propertySectors,
          "headquarters_relocation",
          `headquarters:${corp._id.toHexString()}:${parsed.data.countryId}:${parsed.data.regionId}`
        );
    if (!needsCurrencyConversion && !hqTransitionKeys) {
      return errorResponse(
        409,
        "A sector changed or acquired secured construction during relocation"
      );
    }
    try {
      const updateResult = await db.collection<Corporation>("corporations").updateOne(
        {
          _id: new ObjectId(id),
          primaryUnderwritingIncomingFunding: { $exists: false },
          bankUnderwritingFunding: { $exists: false },
          headquartersRelocationBondFunding: { $exists: false },
        },
        {
          $set: {
            countryId: parsed.data.countryId,
            headquartersState: parsed.data.regionId,
            updatedAt: now,
          },
        }
      );
      if (updateResult.matchedCount !== 1) {
        return errorResponse(
          409,
          "Primary underwriting cash is settling; retry relocation after settlement"
        );
      }
    } finally {
      if (hqTransitionKeys) {
        await Promise.all(
          propertySectors.map((sector, index) =>
            releaseConstructionPropertyTransition(db, sector._id, hqTransitionKeys[index])
          )
        );
      }
    }
    if (corp.ceoId && corp.ceoVacant !== true) {
      const ceoRecord =
        corp.ceoType === "imperial"
          ? await db
              .collection<ImperialCharacter>("imperialCharacters")
              .findOne({ _id: corp.ceoId }, { projection: { homeState: 1 } })
          : await db
              .collection<Character>("characters")
              .findOne({ _id: corp.ceoId }, { projection: { homeState: 1 } });
      // NatCorp CEOs are HQ-state exempt (relaxed country-level residency), so an
      // HQ move within the country must not unseat them.
      if (
        !isStateOwned(corp) &&
        !doesCeoResideAtHeadquarters(ceoRecord?.homeState, parsed.data.regionId)
      ) {
        await vacateCorporationCeo(db, corp._id, now);
      }
    }

    return NextResponse.json({
      success: true,
      currencyConversion: currencyConversion?.converted
        ? {
            from: currencyConversion.fromCurrency,
            to: currencyConversion.toCurrency,
            scale: currencyConversion.scale,
            sectorsConverted: currencyConversion.sectorsConverted,
            ordersCancelled: currencyConversion.ordersCancelled,
            listingsCancelled: currencyConversion.listingsCancelled,
          }
        : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

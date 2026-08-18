import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import {
  getImperialConfig,
  getImperialEligibleCountries,
  getImperialPossessive,
  getImperialTitle,
} from "@/lib/imperial";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { fetchBordersByUserIds } from "@/lib/db/patreonBorders";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import type { Corporation } from "@/lib/db/types/corporation";
import type { User } from "@/lib/db/types/user";
import type { CountryId } from "@/lib/constants/countries";

const IMPERIAL_STARTING_CAPITAL = 50_000_000;
const IMPERIAL_INITIAL_SHARES = 10_000_000;
const IMPERIAL_SHARE_PRICE = 0.1;

const createSchema = z.object({
  // countryId is runtime-validated below against getImperialEligibleCountries()
  // — the prior compile-time enum stayed in lockstep with the imperial-eligible
  // config list manually; switching to z.string() lets that helper be the
  // single source of truth without a code redeploy when a new imperial country
  // ships.
  countryId: z.string(),
  name: z.string().min(2).max(50),
  gender: z.enum(["male", "female", "nonbinary"]),
  royalHouse: z.string().min(2).max(80),
  homeState: z.string().min(1),
  bio: z.string().max(500).optional(),
});

/**
 * POST /api/imperial-characters — Create a new imperial character.
 * Auth: requireAdmin() — admin only.
 * Errors: 400 (validation, ineligible country, already exists), 403 (not admin).
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, createSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { countryId, name, gender, royalHouse, homeState, bio } = parsed.data;
    const db = await getDb();

    // Validate country is eligible for imperial characters
    const eligibleCountries = getImperialEligibleCountries();
    if (!eligibleCountries.includes(countryId as CountryId)) {
      return NextResponse.json(
        { error: `${countryId} is not eligible for imperial characters` },
        { status: 400 }
      );
    }

    // Check no imperial character already exists for this country
    const existing = await db
      .collection<ImperialCharacter>("imperialCharacters")
      .findOne({ countryId: countryId as CountryId });
    if (existing) {
      return NextResponse.json(
        { error: `An imperial character already exists for ${countryId}` },
        { status: 400 }
      );
    }

    const imperialConfig = getImperialConfig(countryId as CountryId);
    if (!imperialConfig) {
      return NextResponse.json(
        { error: "Imperial configuration not found for this country" },
        { status: 400 }
      );
    }

    const now = new Date();
    const adminUserId = new ObjectId(auth.admin.userId);
    const imperialId = new ObjectId();
    const sequentialId = await getNextSequentialId(db, "imperial");

    // Create imperial character document
    const imperialCharacter: ImperialCharacter = {
      _id: imperialId,
      userId: adminUserId,
      countryId: countryId as CountryId,
      name,
      gender,
      homeState,
      sequentialId,
      royalHouse,
      bio: bio ?? undefined,
      createdAt: now,
      updatedAt: now,
    };

    await db.collection<ImperialCharacter>("imperialCharacters").insertOne(imperialCharacter);

    // Create starter corporation
    const corpSequentialId = await getNextSequentialId(db, "corporation");
    const corporation: Omit<Corporation, "_id"> = {
      name: imperialConfig.corporation.name,
      type: imperialConfig.corporation.sector as Corporation["type"],
      countryId: countryId as CountryId,
      ceoId: imperialId,
      ceoType: "imperial",
      userId: adminUserId,
      headquartersState: homeState,
      liquidCapital: IMPERIAL_STARTING_CAPITAL,
      marketingBudget: 0,
      marketingStrength: 10,
      logisticsBudget: 0,
      logisticsStrength: 0,
      ceoSalary: 0,
      totalShares: IMPERIAL_INITIAL_SHARES,
      sharePrice: IMPERIAL_SHARE_PRICE,
      shareholders: [{ imperialCharacterId: imperialId, shares: IMPERIAL_INITIAL_SHARES }],
      publicFloat: 0,
      sequentialId: corpSequentialId,
      createdAt: now,
      updatedAt: now,
    };

    await db.collection<Corporation>("corporations").insertOne(corporation as Corporation);

    // Update user document: set active imperial character
    await db.collection<User>("users").updateOne(
      { _id: adminUserId },
      {
        $set: {
          activeImperialCharacterId: imperialId,
          activeCharacterType: "imperial" as const,
          updatedAt: now,
        },
      }
    );

    // Soft-delete existing ceremonial NPP for this country
    await db.collection("npps").updateMany(
      {
        countryId: countryId as CountryId,
        retiredAt: { $ne: null },
        currentOffice: null,
        party: "independent",
        "personality.ambition": 0,
      },
      { $set: { supersededByImperial: true, updatedAt: now } }
    );

    return NextResponse.json(
      {
        success: true,
        imperialCharacterId: imperialId.toString(),
        sequentialId,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * GET /api/imperial-characters?countryId=UK — Fetch imperial character for a country.
 * Auth: none (public data for country page display).
 * Errors: 400 (missing countryId).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const countryId = searchParams.get("countryId");
    if (!countryId) {
      return NextResponse.json({ error: "countryId required" }, { status: 400 });
    }

    const db = await getDb();

    // Check if this country shares another's imperial character
    const config = COUNTRY_CONFIGS[countryId as CountryId];
    const resolvedCountryId = config?.imperialSharedWith ?? countryId;

    const imperial = await db
      .collection<ImperialCharacter>("imperialCharacters")
      .findOne({ countryId: resolvedCountryId as CountryId });

    if (!imperial) {
      return NextResponse.json({ imperial: null });
    }

    const title = getImperialTitle(imperial.countryId, imperial.gender);
    const possessive = getImperialPossessive(imperial.countryId, imperial.gender);
    const borderMap = await fetchBordersByUserIds(db, [imperial.userId]);
    const userBorder = borderMap.get(imperial.userId.toString());

    return NextResponse.json({
      imperial: {
        name: imperial.name,
        title,
        fullName: `${title} ${imperial.name}`,
        possessive,
        royalHouse: imperial.royalHouse,
        avatarUrl: imperial.avatarUrl,
        coatOfArmsUrl: imperial.coatOfArmsUrl,
        borderKey: imperial.borderKey ?? userBorder?.borderKey ?? null,
        tintColor: imperial.tintColor ?? userBorder?.tintColor ?? null,
        sequentialId: imperial.sequentialId,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

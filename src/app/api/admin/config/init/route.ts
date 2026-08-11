import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { GameConfig } from "@/lib/db/types";

export async function POST() {
  try {
    // Verify admin authentication
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Check if config already exists
    const existingConfig = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" });

    if (existingConfig) {
      return NextResponse.json({
        success: true,
        message: "Game config already exists",
        config: existingConfig,
      });
    }

    // Create default game config
    const defaultConfig: GameConfig = {
      _id: "default",
      startingFunds: 250000,
      startingActions: 25,
      startingFavorability: 50,
      startingInfamy: 0,
      startingPoliticalInfluence: 0,
      startingDonorBaseLevel: 1,
      baseActionsPerTurn: 4,
      turnLengthMinutes: 60,
      officeActionBonus: {
        // US
        house: 1,
        senate: 2,
        stateSenate: 1,
        governor: 3,
        president: 4,
        vicePresident: 2,
        // UK
        commons: 1,
        primeMinister: 4,
        regionalCouncil: 1,
        // CA
        premier: 2,
        // DE
        bundestag: 1,
        bundesrat: 2,
        chancellor: 4,
        ministerPresident: 2,
        // JP
        sangiin: 1,
        shugiin: 1,
        // CN
        npcDelegate: 1,
        peoplesCongress: 1,
      },
      chairActionBonus: 3,
      partyInfluencePoolMultiplier: 3,
      partyInfluenceMaxBonus: 6,
    };

    await db.collection<GameConfig>("gameConfig").insertOne(defaultConfig);

    return NextResponse.json({
      success: true,
      message: "Game config created successfully",
      config: defaultConfig,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });

    if (!config) {
      return NextResponse.json(
        { error: "Game config not found. Please initialize it first." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      config,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

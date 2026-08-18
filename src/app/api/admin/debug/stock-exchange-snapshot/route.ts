import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import {
  generateStockExchangeSnapshots,
  generateInvestorRankingSnapshot,
} from "@/lib/turn/stockExchangeSnapshot";
import type { StockExchangeSnapshot, InvestorRankingSnapshot, Corporation } from "@/lib/db/types";

interface DiagnosticResult {
  timestamps: {
    now: string;
    currentTurn: number;
  };
  collections: {
    corporations: number;
    corporateSectors: number;
    stockExchangeSnapshots: number;
    investorRankingSnapshots: number;
  };
  snapshots: {
    nyse: StockExchangeSnapshot | null;
    ftse: StockExchangeSnapshot | null;
    global: StockExchangeSnapshot | null;
    investorRanking: InvestorRankingSnapshot | null;
  };
  sampleCorporations: Array<{
    _id: string;
    name: string;
    type: string;
    headquartersState: string;
    sharePrice: number;
    hiddenFromExchange: boolean;
  }>;
  generationResult?: {
    success: boolean;
    stockExchangeListings: {
      nyse: number;
      ftse: number;
      global: number;
    };
    investorRankings: number;
    error?: string;
  };
}

// GET /api/admin/debug/stock-exchange-snapshot — Diagnose stock exchange snapshot state and collection counts.
// Auth: requireAdmin
// Errors: 403
/**
 * GET /api/admin/debug/stock-exchange-snapshot
 * Diagnose stock exchange snapshot state
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameState = await getGameState();

    // Count documents in relevant collections
    const [corpCount, sectorCount, snapshotCount, investorSnapshotCount] = await Promise.all([
      db.collection("corporations").countDocuments(),
      db.collection("corporateSectors").countDocuments(),
      db.collection("stockExchangeSnapshots").countDocuments(),
      db.collection("investorRankingSnapshots").countDocuments(),
    ]);

    // Fetch existing snapshots
    const [nyseSnapshot, ftseSnapshot, globalSnapshot, investorSnapshot] = await Promise.all([
      db.collection<StockExchangeSnapshot>("stockExchangeSnapshots").findOne({ _id: "nyse" }),
      db.collection<StockExchangeSnapshot>("stockExchangeSnapshots").findOne({ _id: "ftse" }),
      db.collection<StockExchangeSnapshot>("stockExchangeSnapshots").findOne({ _id: "global" }),
      db.collection<InvestorRankingSnapshot>("investorRankingSnapshots").findOne({ _id: "global" }),
    ]);

    // Get sample corporations
    const sampleCorps = await db
      .collection<Corporation>("corporations")
      .find({})
      .limit(10)
      .project({
        _id: 1,
        name: 1,
        type: 1,
        headquartersState: 1,
        sharePrice: 1,
        hiddenFromExchange: 1,
      })
      .toArray();

    const result: DiagnosticResult = {
      timestamps: {
        now: new Date().toISOString(),
        currentTurn: gameState?.currentTurn ?? 0,
      },
      collections: {
        corporations: corpCount,
        corporateSectors: sectorCount,
        stockExchangeSnapshots: snapshotCount,
        investorRankingSnapshots: investorSnapshotCount,
      },
      snapshots: {
        nyse: nyseSnapshot,
        ftse: ftseSnapshot,
        global: globalSnapshot,
        investorRanking: investorSnapshot,
      },
      sampleCorporations: sampleCorps.map((c) => ({
        _id: c._id.toString(),
        name: c.name,
        type: c.type,
        headquartersState: c.headquartersState,
        sharePrice: c.sharePrice ?? 0,
        hiddenFromExchange: c.hiddenFromExchange ?? false,
      })),
    };

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/admin/debug/stock-exchange-snapshot — Manually trigger stock exchange snapshot generation and return diagnostic data.
// Auth: requireAdmin
// Errors: 403
/**
 * POST /api/admin/debug/stock-exchange-snapshot
 * Manually trigger snapshot generation and return diagnostic data
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;

    let generationError: string | undefined;

    // Generate snapshots
    try {
      await generateStockExchangeSnapshots(currentTurn, db);
      await generateInvestorRankingSnapshot(currentTurn, db);
    } catch (err) {
      generationError = err instanceof Error ? err.message : String(err);
    }

    // Fetch the newly generated snapshots
    const [nyseSnapshot, ftseSnapshot, globalSnapshot, investorSnapshot] = await Promise.all([
      db.collection<StockExchangeSnapshot>("stockExchangeSnapshots").findOne({ _id: "nyse" }),
      db.collection<StockExchangeSnapshot>("stockExchangeSnapshots").findOne({ _id: "ftse" }),
      db.collection<StockExchangeSnapshot>("stockExchangeSnapshots").findOne({ _id: "global" }),
      db.collection<InvestorRankingSnapshot>("investorRankingSnapshots").findOne({ _id: "global" }),
    ]);

    // Count documents
    const [corpCount, sectorCount, snapshotCount, investorSnapshotCount] = await Promise.all([
      db.collection("corporations").countDocuments(),
      db.collection("corporateSectors").countDocuments(),
      db.collection("stockExchangeSnapshots").countDocuments(),
      db.collection("investorRankingSnapshots").countDocuments(),
    ]);

    // Get sample corporations
    const sampleCorps = await db
      .collection<Corporation>("corporations")
      .find({})
      .limit(10)
      .project({
        _id: 1,
        name: 1,
        type: 1,
        headquartersState: 1,
        sharePrice: 1,
        hiddenFromExchange: 1,
      })
      .toArray();

    const result: DiagnosticResult = {
      timestamps: {
        now: new Date().toISOString(),
        currentTurn,
      },
      collections: {
        corporations: corpCount,
        corporateSectors: sectorCount,
        stockExchangeSnapshots: snapshotCount,
        investorRankingSnapshots: investorSnapshotCount,
      },
      snapshots: {
        nyse: nyseSnapshot,
        ftse: ftseSnapshot,
        global: globalSnapshot,
        investorRanking: investorSnapshot,
      },
      sampleCorporations: sampleCorps.map((c) => ({
        _id: c._id.toString(),
        name: c.name,
        type: c.type,
        headquartersState: c.headquartersState,
        sharePrice: c.sharePrice ?? 0,
        hiddenFromExchange: c.hiddenFromExchange ?? false,
      })),
      generationResult: {
        success: !generationError,
        stockExchangeListings: {
          nyse: nyseSnapshot?.listings?.length ?? 0,
          ftse: ftseSnapshot?.listings?.length ?? 0,
          global: globalSnapshot?.listings?.length ?? 0,
        },
        investorRankings: investorSnapshot?.rankings?.length ?? 0,
        error: generationError,
      },
    };

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}

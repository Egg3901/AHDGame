import type { Db } from "mongodb";
import type { Migration } from "../types";

const INDEXES = [
  {
    collection: "shareOrders",
    keys: { liquidityProvider: 1, status: 1 },
    options: {
      name: "share_orders_liquidity_provider_open",
      sparse: true,
      background: true,
    },
  },
  {
    collection: "equityLiquidityFacilitySnapshots",
    keys: { turn: -1 },
    options: {
      name: "equity_liquidity_snapshots_turn",
      unique: true,
      background: true,
    },
  },
] as const;

export const migration: Migration = {
  id: "2026-08-28-equity-liquidity-indexes",
  description: "Indexes for active liquidity quotes and one facility snapshot per turn.",
  idempotent: true,
  execute: async (db: Db, ctx) => {
    const notes: string[] = [];
    for (const plan of INDEXES) {
      const label = `${plan.collection}.${plan.options.name}`;
      if (ctx.dryRun) {
        notes.push(`would create ${label}`);
        continue;
      }
      await db.collection(plan.collection).createIndex(plan.keys, plan.options);
      notes.push(`created/verified ${label}`);
    }
    return {
      documentsScanned: INDEXES.length,
      documentsUpdated: ctx.dryRun ? 0 : INDEXES.length,
      notes,
    };
  },
};

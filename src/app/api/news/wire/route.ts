/**
 * GET /api/news/wire
 * Returns recent game events for the wire service ticker.
 *
 * Sources:
 * - wireEvents collection (PvP attacks, corps, bonds, dividends — logged at action time)
 * - newsPosts collection (system news: elections, legislation, executive)
 * - Fallback: corporations/bonds collections for events before wireEvents existed
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { Corporation, Bond, NewsPost, State } from "@/lib/db/types";
import { formatSectorTypeSlugsInText } from "@/lib/utils/formatSectorTypeSlugsInText";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { BOND_MATURITY_LABELS, type BondMaturityTurns } from "@/lib/db/types/bond";
import type { WireEvent } from "@/lib/wireEvent";

import type { WireItem } from "@/lib/news/types";
import { withPublicNewsVisibility } from "@/lib/news/publicModeration";

// Re-export for any consumer that still imports types from the route file.
// New consumers should import from "@/lib/news/types".
export type { WireItem } from "@/lib/news/types";

/** Map wireEvent.type to WireItem.type */
const WIRE_EVENT_TYPE_MAP: Record<string, WireItem["type"]> = {
  sector_attack: "pvp_action",
  sector_captured: "pvp_action",
  corporation_founded: "corporation_founded",
  corporation_relocated: "corporation_relocated",
  corporation_dissolved: "corporation_dissolved",
  dividend_changed: "dividend_changed",
  bond_issued: "bond_issued",
  corp_credit_rating: "corp_credit_rating",
};

// GET /api/news/wire — Return recent wire service events including corporate, bond, and election news from the last 48 hours.
// Auth: public
// Errors: (none)
export async function GET() {
  try {
    const db = await getDb();
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000); // last 48 hours

    // Primary: wireEvents + system news. Fallback collections for bootstrapping.
    const [wireEvents, systemNews, wireEventCount] = await Promise.all([
      db
        .collection<WireEvent>("wireEvents")
        .find({ timestamp: { $gte: since } })
        .sort({ timestamp: -1 })
        .limit(50)
        .toArray(),

      db
        .collection<NewsPost>("newsPosts")
        .find(withPublicNewsVisibility({ isSystem: true, createdAt: { $gte: since } }))
        .sort({ createdAt: -1 })
        .limit(20)
        .project({ content: 1, category: 1, createdAt: 1 })
        .toArray(),

      db.collection<WireEvent>("wireEvents").countDocuments({ timestamp: { $gte: since } }),
    ]);

    const items: WireItem[] = [];

    // Add wire events (canonical source for corp/bond/dividend/pvp)
    for (const w of wireEvents) {
      items.push({
        id: `wire-${w._id}`,
        type: WIRE_EVENT_TYPE_MAP[w.type] ?? "system_news",
        headline: formatSectorTypeSlugsInText(w.headline),
        timestamp: w.timestamp.toISOString(),
        href: w.href,
      });
    }

    // Only use collection-based fallback if wireEvents is sparse (bootstrapping)
    if (wireEventCount < 5) {
      const stateRows = await db
        .collection<State>("states")
        .find({})
        .project<Pick<State, "_id" | "name">>({ _id: 1, name: 1 })
        .toArray();
      const stateNameById = new Map(stateRows.map((s) => [s._id, s.name]));
      const [recentCorps, recentBonds, recentDividendCorps] = await Promise.all([
        db
          .collection<Corporation>("corporations")
          .find({ createdAt: { $gte: since } })
          .sort({ createdAt: -1 })
          .limit(20)
          .project({ name: 1, type: 1, headquartersState: 1, createdAt: 1, sequentialId: 1 })
          .toArray(),

        db
          .collection<Bond>("bonds")
          .find({ createdAt: { $gte: since } })
          .sort({ createdAt: -1 })
          .limit(20)
          .project({
            corporationId: 1,
            couponRate: 1,
            totalIssued: 1,
            maturityTurns: 1,
            createdAt: 1,
          })
          .toArray(),

        db
          .collection<Corporation>("corporations")
          .find({ lastDividendChange: { $gte: since } })
          .sort({ lastDividendChange: -1 })
          .limit(20)
          .project({ name: 1, dividendRate: 1, lastDividendChange: 1, sequentialId: 1 })
          .toArray(),
      ]);

      // Resolve corporation names for bonds
      const bondCorpIds = recentBonds.map((b) => b.corporationId);
      const bondCorps = bondCorpIds.length
        ? await db
            .collection<Corporation>("corporations")
            .find({ _id: { $in: bondCorpIds } })
            .project({ name: 1, sequentialId: 1 })
            .toArray()
        : [];
      const corpDataMap = new Map(
        bondCorps.map((c) => [
          c._id.toString(),
          { name: c.name, href: `/corporation/${c.sequentialId ?? c._id}` },
        ])
      );

      for (const c of recentCorps) {
        const typeLabel =
          CORPORATION_TYPE_LABELS[c.type as keyof typeof CORPORATION_TYPE_LABELS] ?? c.type;
        const hqLabel = stateNameById.get(c.headquartersState) ?? c.headquartersState;
        items.push({
          id: `corp-${c._id}`,
          type: "corporation_founded",
          headline: `NEW: ${c.name} (${typeLabel}) incorporated in ${hqLabel}`,
          timestamp: (c.createdAt as Date).toISOString(),
          href: `/corporation/${c.sequentialId ?? c._id}`,
        });
      }

      for (const b of recentBonds) {
        const corpData = corpDataMap.get(b.corporationId.toString());
        const corpName = corpData?.name ?? "Unknown Corp";
        const matLabel =
          BOND_MATURITY_LABELS[b.maturityTurns as BondMaturityTurns] ?? `${b.maturityTurns}T`;
        items.push({
          id: `bond-${b._id}`,
          type: "bond_issued",
          headline: `BOND: ${corpName} issues $${(b.totalIssued / 1000).toFixed(0)}K in ${matLabel} bonds at ${b.couponRate.toFixed(1)}%`,
          timestamp: (b.createdAt as Date).toISOString(),
          href: corpData?.href,
        });
      }

      for (const c of recentDividendCorps) {
        items.push({
          id: `div-${c._id}`,
          type: "dividend_changed",
          headline: `DIV: ${c.name} sets dividend to ${(c.dividendRate ?? 0).toFixed(0)}%`,
          timestamp: (c.lastDividendChange as Date).toISOString(),
          href: `/corporation/${c.sequentialId ?? c._id}`,
        });
      }
    }

    // Always include system news (not logged to wireEvents)
    for (const n of systemNews) {
      const formatted = formatSectorTypeSlugsInText(n.content as string);
      const text = formatted.length > 80 ? formatted.slice(0, 77) + "..." : formatted;
      const prefix =
        n.category === "election"
          ? "ELECTION"
          : n.category === "legislation"
            ? "BILL"
            : n.category === "executive"
              ? "EXEC"
              : n.category === "sovereign"
                ? "SOVEREIGN"
                : "NEWS";
      items.push({
        id: `news-${n._id}`,
        type: "system_news",
        headline: `${prefix}: ${text}`,
        timestamp: (n.createdAt as Date).toISOString(),
      });
    }

    // Sort by timestamp descending
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({ items: items.slice(0, 50) });
  } catch (error) {
    return handleRouteError(error);
  }
}

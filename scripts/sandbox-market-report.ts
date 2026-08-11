/**
 * Sandbox Market Status Report
 * Queries the sandbox DB for corporation and commodity market imbalances.
 *
 * Usage: npx tsx scripts/sandbox-market-report.ts
 */
import { MongoClient, Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI not found in .env.local");

const SANDBOX_DB = "a-house-divided-sandbox";

async function getDb(): Promise<Db> {
  const client = new MongoClient(uri!);
  await client.connect();
  return client.db(SANDBOX_DB);
}

async function main() {
  const db = await getDb();
  console.log(`=== Sandbox Market Report — ${SANDBOX_DB} ===\n`);

  // =========================
  // CORPORATION MARKET STATUS
  // =========================
  console.log("## CORPORATION MARKET STATUS\n");

  const corps = await db.collection("corporations").find({}).toArray();
  console.log(`Total corporations: ${corps.length}\n`);

  if (corps.length === 0) {
    console.log("No corporations found in sandbox.\n");
  } else {
    // Sort by share price desc
    const sortedByPrice = [...corps].sort((a, b) => (b.sharePrice || 0) - (a.sharePrice || 0));

    console.log("### Top 15 by Share Price\n");
    console.log(
      "| # | Name | Ticker | Share Price | Total Shares | Market Cap | Liquid Capital | Country | CEO Vacant |"
    );
    console.log(
      "|---|------|--------|-------------|--------------|------------|----------------|---------|------------|"
    );
    sortedByPrice.slice(0, 15).forEach((c, i) => {
      const price = c.sharePrice || 0;
      const shares = c.totalShares || 0;
      const mcap = price * shares;
      const liq = c.liquidCapital || 0;
      const vacant = c.ceoVacant ? "YES" : "no";
      console.log(
        `| ${i + 1} | ${c.name} | ${c.tickerSymbol || "—"} | $${price.toFixed(2)} | ${shares.toLocaleString()} | $${mcap.toLocaleString()} | $${liq.toLocaleString()} | ${c.countryId || "?"} | ${vacant} |`
      );
    });

    // Share price distribution
    const prices = corps.map((c) => c.sharePrice || 0).filter((p) => p > 0);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const medianPrice = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)];

    console.log("\n### Share Price Distribution\n");
    console.log(`- Count with price > 0: ${prices.length}`);
    console.log(`- Min: $${minPrice.toFixed(2)}`);
    console.log(`- Max: $${maxPrice.toFixed(2)}`);
    console.log(`- Median: $${medianPrice.toFixed(2)}`);
    console.log(`- Average: $${avgPrice.toFixed(2)}`);

    // Extreme values
    const zeroPrice = corps.filter((c) => (c.sharePrice || 0) <= 0);
    if (zeroPrice.length > 0) {
      console.log(`\n⚠️ **ZERO SHARE PRICE**: ${zeroPrice.length} corporations`);
      zeroPrice.forEach((c) => console.log(`  - ${c.name} (${c.tickerSymbol || "no ticker"})`));
    }

    // Imbalance: market cap vs liquid capital ratio
    const ratios = corps
      .map((c) => {
        const mcap = (c.sharePrice || 0) * (c.totalShares || 0);
        const liq = c.liquidCapital || 0;
        return {
          name: c.name,
          ticker: c.tickerSymbol,
          mcap,
          liq,
          ratio: liq > 0 ? mcap / liq : mcap,
        };
      })
      .filter((r) => r.mcap > 0)
      .sort((a, b) => b.ratio - a.ratio);

    console.log("\n### Market Cap / Liquid Capital Ratio (Top 10 Highest)\n");
    console.log("| Name | Ticker | Market Cap | Liquid Capital | Ratio |");
    console.log("|------|--------|------------|----------------|-------|");
    ratios.slice(0, 10).forEach((r) => {
      console.log(
        `| ${r.name} | ${r.ticker || "—"} | $${r.mcap.toLocaleString()} | $${r.liq.toLocaleString()} | ${r.ratio.toFixed(1)}x |`
      );
    });

    console.log("\n### Market Cap / Liquid Capital Ratio (Top 10 Lowest)\n");
    console.log("| Name | Ticker | Market Cap | Liquid Capital | Ratio |");
    console.log("|------|--------|------------|----------------|-------|");
    ratios.slice(-10).forEach((r) => {
      console.log(
        `| ${r.name} | ${r.ticker || "—"} | $${r.mcap.toLocaleString()} | $${r.liq.toLocaleString()} | ${r.ratio.toFixed(1)}x |`
      );
    });

    // CEO vacant
    const vacantCeos = corps.filter((c) => c.ceoVacant);
    if (vacantCeos.length > 0) {
      console.log(`\n### CEO Vacant Positions: ${vacantCeos.length}\n`);
      vacantCeos.forEach((c) =>
        console.log(
          `  - ${c.name} (${c.tickerSymbol || "no ticker"}) — vacant since turn ${c.ceoVacantSinceTurn || "?"}`
        )
      );
    }

    // IMF bailouts
    const bailouts = corps.filter((c) => c.imfBailoutActive);
    if (bailouts.length > 0) {
      console.log(`\n### IMF Bailouts Active: ${bailouts.length}\n`);
      bailouts.forEach((c) => console.log(`  - ${c.name}`));
    }

    // Suspended
    const suspended = corps.filter((c) => c.suspended);
    if (suspended.length > 0) {
      console.log(`\n### Suspended Corporations: ${suspended.length}\n`);
      suspended.forEach((c) => console.log(`  - ${c.name}`));
    }
  }

  // =========================
  // COMMODITY MARKET STATUS
  // =========================
  console.log("\n\n## COMMODITY MARKET STATUS\n");

  const commodities = await db.collection("commodityPrices").find({}).toArray();
  console.log(`Total commodity price records: ${commodities.length}\n`);

  if (commodities.length === 0) {
    console.log("No commodity price records found in sandbox.\n");
  } else {
    console.log(
      "| Commodity | Turn | Base Price | Global Price | Supply | Demand | S/D Ratio | States |"
    );
    console.log(
      "|-----------|------|------------|--------------|--------|--------|-----------|--------|"
    );

    for (const c of commodities) {
      const supply = c.globalSupply || 0;
      const demand = c.globalDemand || 0;
      const sdRatio = demand > 0 ? supply / demand : supply > 0 ? Infinity : 1;
      const stateCount = Object.keys(c.statePrices || {}).length;
      const ratioStr = sdRatio === Infinity ? "∞" : sdRatio.toFixed(2);
      const imbalance =
        sdRatio > 5
          ? " 🚨 MASSIVE SURPLUS"
          : sdRatio < 0.2
            ? " 🚨 MASSIVE SHORTAGE"
            : sdRatio > 2
              ? " ⚠️ Surplus"
              : sdRatio < 0.5
                ? " ⚠️ Shortage"
                : "";

      console.log(
        `| ${c.commodity} | ${c.turn} | $${c.basePrice} | $${c.globalPrice?.toFixed(2) || "?"} | ${supply.toLocaleString()} | ${demand.toLocaleString()} | ${ratioStr} | ${stateCount} |${imbalance}`
      );
    }

    // Per-commodity state price variance
    console.log("\n### State Price Variance (per commodity)\n");
    for (const c of commodities) {
      const prices = Object.values(c.statePrices || {}) as number[];
      if (prices.length < 2) continue;
      const avg = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const variance = max - min;
      const cv =
        avg > 0
          ? (Math.sqrt(
              prices.reduce((s: number, p: number) => s + (p - avg) ** 2, 0) / prices.length
            ) /
              avg) *
            100
          : 0;
      if (variance > avg * 0.5) {
        console.log(
          `⚠️ **${c.commodity}**: min=$${min.toFixed(2)}, max=$${max.toFixed(2)}, avg=$${avg.toFixed(2)}, CV=${cv.toFixed(1)}%`
        );
      }
    }

    // National price summary
    console.log("\n### National Price Summary\n");
    for (const c of commodities) {
      const national = c.nationalPrices || {};
      const entries = Object.entries(national) as [string, number][];
      if (entries.length === 0) continue;
      const avg = entries.reduce((s, [, p]) => s + p, 0) / entries.length;
      const min = Math.min(...entries.map(([, p]) => p));
      const max = Math.max(...entries.map(([, p]) => p));
      if (max > avg * 2 || min < avg * 0.5) {
        console.log(
          `⚠️ **${c.commodity}**: national avg=$${avg.toFixed(2)}, range=$${min.toFixed(2)}–$${max.toFixed(2)}`
        );
        const extremes = entries.filter(([, p]) => p > avg * 2 || p < avg * 0.5);
        extremes.forEach(([country, price]) => {
          const marker = price > avg * 2 ? "🔺" : "🔻";
          console.log(`   ${marker} ${country}: $${price.toFixed(2)}`);
        });
      }
    }
  }

  // =========================
  // SHARE LISTINGS / ORDERS
  // =========================
  console.log("\n\n## SHARE MARKET ACTIVITY\n");

  const listings = await db.collection("shareListings").find({}).toArray();
  const orders = await db.collection("shareOrders").find({}).toArray();
  console.log(
    `Open share listings: ${listings.filter((l) => l.status === "open").length} / ${listings.length} total`
  );
  console.log(
    `Open share orders: ${orders.filter((o) => o.status === "open").length} / ${orders.length} total\n`
  );

  if (orders.length > 0) {
    const openOrders = orders.filter((o) => o.status === "open");
    const buyOrders = openOrders.filter((o) => o.type === "buy");
    const sellOrders = openOrders.filter((o) => o.type === "sell");
    console.log(
      `Open buy orders: ${buyOrders.length} (${buyOrders.reduce((s, o) => s + (o.sharesRemaining || 0), 0)} shares)`
    );
    console.log(
      `Open sell orders: ${sellOrders.length} (${sellOrders.reduce((s, o) => s + (o.sharesRemaining || 0), 0)} shares)`
    );
  }

  // =========================
  // SECTORS
  // =========================
  console.log("\n\n## SECTOR OVERVIEW\n");
  const sectors = await db.collection("corporationSectors").find({}).toArray();
  console.log(`Total sectors: ${sectors.length}\n`);

  if (sectors.length > 0) {
    const byType: Record<string, number> = {};
    sectors.forEach((s) => {
      byType[s.sectorType] = (byType[s.sectorType] || 0) + 1;
    });
    console.log("| Sector Type | Count |");
    console.log("|-------------|-------|");
    Object.entries(byType)
      .sort(([, a], [, b]) => b - a)
      .forEach(([type, count]) => console.log(`| ${type} | ${count} |`));

    // Zero revenue sectors
    const zeroRev = sectors.filter((s) => (s.revenue || 0) <= 0);
    if (zeroRev.length > 0) {
      console.log(`\n⚠️ **ZERO REVENUE SECTORS**: ${zeroRev.length}`);
    }

    // Extreme workers
    const totalWorkers = sectors.reduce((s, sec) => s + (sec.workers || 0), 0);
    console.log(`\nTotal workers across all sectors: ${totalWorkers.toLocaleString()}`);
  }

  console.log("\n=== END OF REPORT ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Report failed:", err);
  process.exit(1);
});

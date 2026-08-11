require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  const gs = await db.collection("gameState").findOne({ _id: "current" });
  const currentTurn = gs.currentTurn;

  console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║     A HOUSE DIVIDED — READ-ONLY DB AUDIT: 100% TARIFF IMPACT PROJECTION      ║");
  console.log("╠══════════════════════════════════════════════════════════════════════════════╣");
  console.log(
    "║ Turn: " +
      currentTurn +
      " | Year: " +
      gs.currentYear +
      " | Forex: " +
      gs.forexEnabled +
      "                                    ║"
  );
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
  console.log("");

  // ── SECTION 1: CURRENT TARIFF STATE ──
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("1. CURRENT TARIFF STATE (from DB)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const tariffs = await db.collection("tariffs").find({}).toArray();
  console.log("Tariff records in DB: " + tariffs.length);
  if (tariffs.length > 0) {
    tariffs.forEach((t, i) => {
      console.log(
        "  [" + i + "] country=" + t.countryId + " scope=" + t.scopeType + " rate=" + t.rate + "%"
      );
    });
  } else {
    console.log("  → No active tariffs. All trade flows at 0% duty.");
  }
  console.log("");

  // ── SECTION 2: INFLATION MECHANICS (from codebase) ──
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("2. INFLATION MECHANICS — TARIFF CHANNEL (src/lib/budget/inflation.ts)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Tariff baseline:        3.0% (TARIFF_BASELINE)");
  console.log("Tariff coeff (up):      0.05 pp per 1% above baseline");
  console.log("Tariff coeff (down):    0.025 pp per 1% below baseline");
  console.log("Max inflation cap:      15.0%");
  console.log("Inertia weight:         0.35 (prev rate carries 35%)");
  console.log("Mean reversion:         0.08 × (target − smoothed) per turn");
  console.log("Max per-turn delta:     ±1.5 pp");
  console.log("");
  console.log("Formula: tariffGap = tariffRate − 3.0");
  console.log("         tariffContribution = tariffGap × 0.05 (if above baseline)");
  console.log("");
  console.log("At 100% tariff rate:");
  console.log("  tariffGap = 100 − 3.0 = 97.0");
  console.log("  raw tariff contribution = 97.0 × 0.05 = +4.85 pp");
  console.log("");

  // ── SECTION 3: FOREIGN CORP MARGIN IMPACT ──
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("3. FOREIGN CORP MARGIN IMPACT (src/lib/tariffs/tariffEffects.ts)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Foreign tariff modifier:  −rate / 2  percentage points");
  console.log("Domestic tariff malus:    −(rate/100) × 10 pp (economy-wide + sector only)");
  console.log("Split capture multiplier: 1.0 + (T/100) × 0.5 for domestic (at T=100% → 1.5x)");
  console.log("                          1.0 − (T/100) × 0.5 for foreign (at T=100% → 0.5x)");
  console.log("");
  console.log("At 100% effective tariff rate:");
  console.log("  Foreign corps operating in tariff country: −50 pp margin modifier");
  console.log("  Domestic corps in same country:            −10 pp margin malus");
  console.log("  Domestic market share capture:             1.5x multiplier");
  console.log("  Foreign market share penalty:              0.5x multiplier");
  console.log("");

  // ── SECTION 4: COMMODITY BLEND WEIGHTS ──
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("4. COMMODITY MARGIN BLEND WEIGHTS (tariff-driven)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Baseline blend (no tariffs):  global=0.50, national=0.25, local=0.25");
  console.log("At 100% tariff pressure:      global=0.25, national=0.50, local=0.25");
  console.log("");
  console.log("Effect: Tariffs shift commodity margin calculation from global benchmarks");
  console.log("        toward national benchmarks — domestic input costs matter more.");
  console.log("");

  // ── SECTION 5: CURRENT ECONOMIC BASELINE ──
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("5. CURRENT ECONOMIC BASELINE (from DB)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Central banks
  const cb = await db.collection("centralBanks").find({}).toArray();
  console.log("Central Bank Prime Rates:");
  cb.forEach((b) => console.log("  " + b._id + ": " + b.primeRate + "%"));
  console.log("");

  // Exchange rates
  const fx = await db.collection("exchangeRates").find({}).toArray();
  console.log("Exchange Rates (deviation from base):");
  fx.forEach((r) => {
    const dev = (((r.rate - r.baseRate) / r.baseRate) * 100).toFixed(1);
    console.log(
      "  " +
        r._id +
        ": " +
        r.rate.toFixed(4) +
        " (base " +
        r.baseRate +
        ", " +
        (dev >= 0 ? "+" : "") +
        dev +
        "%)"
    );
  });
  console.log("");

  // Federal budgets
  const budgets = await db.collection("federalBudget").find({}).toArray();
  console.log("Federal Budgets:");
  budgets.forEach((b) => {
    const rev = b.revenue?.total || 0;
    const spend = b.spending?.total || 0;
    const surplus = b.surplus || rev - spend;
    const gdp = b.gdp || 1;
    const surplusPct = ((surplus / gdp) * 100).toFixed(2);
    console.log(
      "  " +
        b._id +
        ": rev=" +
        (rev / 1e9).toFixed(1) +
        "B spend=" +
        (spend / 1e9).toFixed(1) +
        "B surplus=" +
        surplusPct +
        "% GDP"
    );
  });
  console.log("");

  // Commodity state
  const commodities = await db.collection("commodityPrices").find({}).toArray();
  console.log("Commodity Price State (S/D ratio >1.5 = shortage):");
  const shortageCommodities = commodities.filter((c) => c.globalDemand / c.globalSupply > 1.5);
  const surplusCommodities = commodities.filter((c) => c.globalDemand / c.globalSupply < 0.8);
  console.log(
    "  Shortages (" +
      shortageCommodities.length +
      "): " +
      shortageCommodities.map((c) => c.commodity).join(", ")
  );
  console.log(
    "  Surpluses (" +
      surplusCommodities.length +
      "): " +
      surplusCommodities.map((c) => c.commodity).join(", ")
  );
  console.log("");

  // ── SECTION 6: PROJECTED 100% TARIFF IMPACT ──
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("6. PROJECTED IMPACT OF 100% ECONOMY-WIDE TARIFFS");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log("SCENARIO: All 8 countries impose 100% economy-wide tariffs on all imports");
  console.log("");

  // Count foreign vs domestic sector presence
  const sectors = await db.collection("corporateSectors").find({}).toArray();
  const corps = await db.collection("corporations").find({}).toArray();
  const corpById = new Map(corps.map((c) => [c._id.toString(), c]));

  let crossBorderSectors = 0;
  let domesticSectors = 0;
  const countryForeignExposure = {};
  const countryDomesticRevenue = {};

  sectors.forEach((s) => {
    const corp = corpById.get(s.corporationId.toString());
    if (!corp) return;
    if (s.countryId !== corp.countryId) {
      crossBorderSectors++;
      countryForeignExposure[s.countryId] =
        (countryForeignExposure[s.countryId] || 0) + (s.revenue || 0);
    } else {
      domesticSectors++;
      countryDomesticRevenue[s.countryId] =
        (countryDomesticRevenue[s.countryId] || 0) + (s.revenue || 0);
    }
  });

  console.log("Cross-border sectors (foreign corps operating locally): " + crossBorderSectors);
  console.log("Domestic sectors: " + domesticSectors);
  console.log("");

  console.log("Per-Country Foreign Revenue Exposure (sectors where corp HQ ≠ sector country):");
  Object.entries(countryForeignExposure).forEach(([country, rev]) => {
    const domestic = countryDomesticRevenue[country] || 1;
    const pct = ((rev / (rev + domestic)) * 100).toFixed(1);
    console.log(
      "  " +
        country +
        ": $" +
        (rev / 1e6).toFixed(1) +
        "M foreign / $" +
        ((rev + domestic) / 1e6).toFixed(1) +
        "M total (" +
        pct +
        "% foreign)"
    );
  });
  console.log("");

  console.log("──────────────────────────────────────────────────────────────────────────────");
  console.log("INFLATION PROJECTION (per country, assuming all else equal):");
  console.log("──────────────────────────────────────────────────────────────────────────────");
  console.log("");
  console.log("At 100% economy-wide tariff:");
  console.log("  tariffRate input to inflation calc = 100%");
  console.log("  tariffGap = 100 − 3.0 = 97.0");
  console.log("  raw tariff contribution = 97.0 × 0.05 = +4.85 pp");
  console.log("");
  console.log("With inertia (0.35) and mean reversion (0.08):");
  console.log("  If previous inflation = 2.5%:");
  console.log("    smoothedRaw = 0.35×2.5 + 0.65×(2.0 + 4.85) = 0.875 + 4.453 = 5.33%");
  console.log("    meanReversion = 0.08 × (2.0 − 5.33) = −0.27 pp");
  console.log("    smoothed = 5.33 − 0.27 = 5.06%");
  console.log("    delta = 5.06 − 2.5 = 2.56 pp → CLAMPED to +1.5 pp (MAX_PER_TURN_DELTA)");
  console.log("    FINAL next-turn inflation = 2.5 + 1.5 = 4.0%");
  console.log("");
  console.log("  Subsequent turns (tariff stays at 100%):");
  console.log("    Turn 2: 4.0 + 1.5 = 5.5%");
  console.log("    Turn 3: 5.5 + 1.5 = 7.0%");
  console.log("    Turn 4: 7.0 + 1.5 = 8.5%");
  console.log("    Turn 5: approaches equilibrium ~5.0–6.0% (mean reversion pulls toward 2%)");
  console.log("");
  console.log("  Equilibrium estimate (tariff=100%, all other factors neutral):");
  console.log(
    "    ~5.0–6.0% annual inflation (base 2.0 + tariff 4.85, dampened by mean reversion)"
  );
  console.log("");

  console.log("──────────────────────────────────────────────────────────────────────────────");
  console.log("CORPORATE MARGIN IMPACT:");
  console.log("──────────────────────────────────────────────────────────────────────────────");
  console.log("");
  console.log("Foreign corps in tariff country:");
  console.log("  Margin modifier: −50 pp (halved from 100% rate)");
  console.log("  Market share multiplier: 0.5x");
  console.log("  → Most foreign corps become unprofitable; likely divestiture or bankruptcy");
  console.log("");
  console.log("Domestic corps in tariff country:");
  console.log("  Margin malus: −10 pp (from supply-chain friction)");
  console.log("  Market share multiplier: 1.5x (capture foreign corps' share)");
  console.log(
    "  → Net effect depends on margin buffer; healthy corps (+15%+) absorb, thin margin corps fail"
  );
  console.log("");

  console.log("──────────────────────────────────────────────────────────────────────────────");
  console.log("COMMODITY MARKET IMPACT:");
  console.log("──────────────────────────────────────────────────────────────────────────────");
  console.log("");
  console.log("Current shortages (would worsen under trade barriers):");
  shortageCommodities.forEach((c) => {
    const ratio = (c.globalDemand / c.globalSupply).toFixed(2);
    console.log(
      "  " + c.commodity + ": S/D=" + ratio + " (price $" + c.globalPrice.toFixed(2) + ")"
    );
  });
  console.log("");
  console.log("Impact channels:");
  console.log("  1. Commodity blend shifts from global→national benchmarks");
  console.log("  2. Import-dependent commodities (energy, iron, oil) face supply contraction");
  console.log("  3. Extractive commodities (coal, rare_earth, timber) lose export demand");
  console.log("  4. Price formula: price = base × exp(0.7 × ln(supply/demand))");
  console.log("     → Supply shocks amplify exponentially");
  console.log("");

  console.log("──────────────────────────────────────────────────────────────────────────────");
  console.log("FOREX IMPACT:");
  console.log("──────────────────────────────────────────────────────────────────────────────");
  console.log("");
  console.log("Current forex pressure coefficients:");
  console.log("  FOREX_PRESSURE_COEFF_UP = 8.0 (depreciation → inflation)");
  console.log("  FOREX_PRESSURE_COEFF_DOWN = 4.0 (appreciation → deflation)");
  console.log("  FOREX_PRESSURE_CLAMP = 0.25 (max ±0.25 signal)");
  console.log("");
  console.log("At 100% tariffs:");
  console.log("  → Import demand collapses → currency demand for trade falls");
  console.log("  → Domestic substitution → local currency strengthens short-term");
  console.log("  → But supply shocks → import prices rise → inflationary forex pressure");
  console.log("  → Net effect: currency volatility, direction depends on country trade balance");
  console.log("");

  console.log("──────────────────────────────────────────────────────────────────────────────");
  console.log("FISCAL IMPACT:");
  console.log("──────────────────────────────────────────────────────────────────────────────");
  console.log("");
  console.log("Economy-wide tariff revenue = importValue × tariffRate");
  console.log("At 100% rate, tariff revenue maximizes BUT import volume collapses");
  console.log("  → Laffer-curve effect: revenue may actually fall as trade volume → 0");
  console.log("  → Corporate tax revenue falls (unprofitable foreign corps)");
  console.log("  → GDP contraction from trade friction");
  console.log("");

  // ── SECTION 7: SUMMARY ──
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("7. SUMMARY — PROJECTED 100% TARIFF IMPACT");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log("┌────────────────────────┬─────────────────────────────────────────────────────┐");
  console.log("│ Metric                 │ Projected Impact                                    │");
  console.log("├────────────────────────┼─────────────────────────────────────────────────────┤");
  console.log("│ Inflation (equilibrium)│ +2.5 to +3.5 pp above baseline (~5–6% total)      │");
  console.log("│ Inflation (transition) │ +1.5 pp/turn (clamped), reaches 5% by turn 3      │");
  console.log("│ Foreign corp margins   │ −50 pp modifier (mass bankruptcies likely)          │");
  console.log("│ Domestic corp margins  │ −10 pp malus (absorbable by healthy corps)          │");
  console.log("│ Market share shift     │ Domestic 1.5x, Foreign 0.5x                         │");
  console.log("│ Commodity prices       │ Shortages worsen (energy, iron, oil, coal)          │");
  console.log("│ Forex                  │ Volatility; import currencies weaken                │");
  console.log("│ Fiscal revenue         │ Ambiguous (higher rate × lower volume)              │");
  console.log("│ GDP growth             │ Negative (trade friction + supply shocks)           │");
  console.log("└────────────────────────┴─────────────────────────────────────────────────────┘");
  console.log("");
  console.log("NOTE: This is a static projection. Actual in-game effects would compound with:");
  console.log("  • Central bank rate responses (monetary tightening to combat inflation)");
  console.log("  • Corporate divestiture/exit (foreign corps leave, reducing competition)");
  console.log("  • FTA negotiations (countries would seek exemptions)");
  console.log("  • Commodity extraction capacity constraints");
  console.log("  • Player political responses (tariff repeal bills)");
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log("END OF AUDIT — Read-only analysis complete");
  console.log("══════════════════════════════════════════════════════════════════════════════");

  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});

require("dotenv").config({ path: ".env.local" });
const { MongoClient, ObjectId } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  // 1. Get the CNY/USD exchange rate around turn 422
  const cnRate = await db.collection("exchangeRates").findOne({ _id: "CN" });
  const usRate = await db.collection("exchangeRates").findOne({ _id: "US" });
  console.log("=== Exchange Rates ===");
  console.log(`CN rate: ${cnRate?.rate}, baseRate: ${cnRate?.baseRate}`);
  console.log(`US rate: ${usRate?.rate}, baseRate: ${usRate?.baseRate}`);
  console.log(`CN rate history (last 10): ${JSON.stringify(cnRate?.rateHistory?.slice(-10))}`);

  // 2. Check the conversion math
  const priceCNY = 353.56;
  const priceUSD = 31.06;
  const revCNY = 3492735;
  const revUSD = 423802;

  console.log(`\n=== Conversion Math ===`);
  console.log(`Price: ${priceCNY} CNY → ${priceUSD} USD = ${priceCNY / priceUSD}x reduction`);
  console.log(`Revenue: ${revCNY} CNY → ${revUSD} USD = ${revCNY / revUSD}x reduction`);
  console.log(
    `If CN rate = ${cnRate?.rate}, then ${priceCNY} CNY / ${cnRate?.rate} = ${priceCNY / cnRate?.rate} USD`
  );
  console.log(
    `If CN rate = ${cnRate?.rate}, then ${revCNY} CNY / ${cnRate?.rate} = ${revCNY / cnRate?.rate} USD`
  );

  // 3. Check convertCorpCurrency.ts for the conversion logic
  console.log(`\n=== Checking conversion code ===`);

  // 4. Check if there were other corps that had currency conversions
  const conversions = await db
    .collection("corporationHistory")
    .find({ turn: { $gte: 420, $lte: 425 } })
    .sort({ corporationId: 1, turn: 1 })
    .toArray();

  const currencyChanges = [];
  const seen = new Set();
  for (const h of conversions) {
    const key = h.corporationId.toString();
    if (seen.has(key)) continue;
    const next = conversions.find(
      (h2) => h2.corporationId.toString() === key && h2.turn === h.turn + 1
    );
    if (next && h.currencyCode !== next.currencyCode) {
      currencyChanges.push({
        corpId: key,
        fromTurn: h.turn,
        toTurn: next.turn,
        fromCurrency: h.currencyCode,
        toCurrency: next.currencyCode,
        fromRev: h.revenue,
        toRev: next.revenue,
        fromPrice: h.sharePrice,
        toPrice: next.sharePrice,
      });
    }
    seen.add(key);
  }

  // Better approach: group by corp and find currency changes
  const byCorp = {};
  for (const h of conversions) {
    const key = h.corporationId.toString();
    if (!byCorp[key]) byCorp[key] = [];
    byCorp[key].push(h);
  }

  console.log(`\n=== Corps with currency changes (T420-425) ===`);
  for (const [corpId, histArr] of Object.entries(byCorp)) {
    histArr.sort((a, b) => a.turn - b.turn);
    for (let i = 1; i < histArr.length; i++) {
      if (histArr[i].currencyCode !== histArr[i - 1].currencyCode) {
        // Get corp name
        let name = corpId;
        try {
          const c = await db
            .collection("corporations")
            .findOne({ _id: new ObjectId(corpId) }, { projection: { name: 1, countryId: 1 } });
          name = c?.name || corpId;
          console.log(
            `  ${name} (${c?.countryId}): T${histArr[i - 1].turn} ${histArr[i - 1].currencyCode} rev=${histArr[i - 1].revenue?.toFixed(0)} → T${histArr[i].turn} ${histArr[i].currencyCode} rev=${histArr[i].revenue?.toFixed(0)}`
          );
        } catch {}
      }
    }
  }

  // 5. Check the share price formula to understand why it crashed
  // The price is derived from sectorNPV + liquidCapital / shares
  // If sectorNPV was converted from CNY to USD, the price should drop proportionally
  const aacId = new ObjectId("6a1b9e31a9a5bdf9cfee9d8a");
  const t421 = await db
    .collection("corporationHistory")
    .findOne({ corporationId: aacId, turn: 421 });
  const t422 = await db
    .collection("corporationHistory")
    .findOne({ corporationId: aacId, turn: 422 });
  console.log(`\n=== AAC Full Comparison ===`);
  console.log(
    `T421: currency=${t421.currencyCode}, price=${t421.sharePrice}, sectorNPV=${t421.sectorNPV}, liquidCapital=${t421.liquidCapital}, revenue=${t421.revenue}, income=${t421.income}`
  );
  console.log(
    `T422: currency=${t422.currencyCode}, price=${t422.sharePrice}, sectorNPV=${t422.sectorNPV}, liquidCapital=${t422.liquidCapital}, revenue=${t422.revenue}, income=${t422.income}`
  );
  console.log(`\nRatios:`);
  console.log(`  Price ratio: ${t421.sharePrice / t422.sharePrice}`);
  console.log(`  NPV ratio: ${t421.sectorNPV / t422.sectorNPV}`);
  console.log(`  Revenue ratio: ${t421.revenue / t422.revenue}`);
  console.log(`  LiquidCapital ratio: ${t421.liquidCapital / t422.liquidCapital}`);
  console.log(`  CN exchange rate: ${cnRate?.rate}`);

  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});

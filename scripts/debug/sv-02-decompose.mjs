import * as dotenv from "dotenv";
import { MongoClient } from "mongodb";
dotenv.config({ path: "E:/Program Projects/A House Divided/.env.local" });
let uri = process.env.MONGODB_URI_LIVE;
if (!uri.includes("directConnection"))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
const client = new MongoClient(uri);
const M = (n) =>
  n == null ? "-" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
try {
  await client.connect();
  const db = client.db();
  const gs = await db.collection("gameState").findOne({ _id: "current" });
  const turn = gs.currentTurn;

  console.log("===== TOP 25 PUBLIC CORPS BY SHARE PRICE (isPrivate:false) =====");
  const corps = await db
    .collection("corporations")
    .find(
      { isPrivate: false, dissolvedTurn: { $exists: false } },
      {
        projection: {
          name: 1,
          tickerSymbol: 1,
          countryId: 1,
          sharePrice: 1,
          fundamentalSharePrice: 1,
          totalShares: 1,
          liquidCapital: 1,
          type: 1,
          sequentialId: 1,
          unlockedTechNodeIds: 1,
          superShareMultiplier: 1,
          orderFlowMultiplier: 1,
          shareIssuanceProceeds: 1,
        },
      }
    )
    .sort({ sharePrice: -1 })
    .limit(25)
    .toArray();
  for (const c of corps) {
    console.log(
      `${String(c.sequentialId).padEnd(5)} ${String(c.tickerSymbol || "").padEnd(6)} ${String(c.name).slice(0, 24).padEnd(24)} ${c.countryId} px=${M(c.sharePrice)} fund=${M(c.fundamentalSharePrice)} sh=${M(c.totalShares)} cash=${M(c.liquidCapital)} tech=${(c.unlockedTechNodeIds || []).length} ofm=${(c.orderFlowMultiplier ?? 1).toFixed(3)} mcap=${M((c.sharePrice || 0) * (c.totalShares || 0))}`
    );
  }

  const tt = await db.collection("corporations").findOne({ sequentialId: 738 });
  const cid = tt._id;

  console.log("\n===== CORP 738 HISTORY (last 40 turns) =====");
  const hist = await db
    .collection("corporationHistory")
    .find({ corporationId: cid, turn: { $gte: turn - 40 } })
    .sort({ turn: 1 })
    .toArray();
  console.log(
    "turn | sharePrice | sectorNPV | revenue | incomePreDiv | liquidCapital | totalShares | mcap"
  );
  for (const h of hist) {
    console.log(
      `${h.turn} | ${M(h.sharePrice)} | ${M(h.sectorNPV)} | ${M(h.revenue)} | ${M(h.incomePreDividends)} | ${M(h.liquidCapital)} | ${M(h.totalShares)} | ${M(h.marketCap)}`
    );
  }

  console.log("\n===== CORP 738 earningsHistory =====");
  console.log(JSON.stringify(tt.earningsHistory, null, 1));

  console.log("\n===== CORP 738 SECTORS =====");
  const secs = await db.collection("corporationSectors").find({ corporationId: cid }).toArray();
  console.log("count", secs.length);
  for (const s of secs) {
    console.log(
      `  ${s.sectorType || s.type} rev=${M(s.revenue)} npv=${M(s.npv ?? s.sectorNPV)} growth=${s.currentGrowthRate ?? s.growthRate} capital=${M(s.capitalStock)} cip=${M(s.constructionInProgress)}`
    );
  }

  console.log("\n===== CORP 738 SHAREHOLDERS =====");
  console.log(JSON.stringify(tt.shareholders, null, 1));

  console.log("\n===== SHARE TRADE HISTORY corp 738 =====");
  const trades = await db
    .collection("shareTradeHistory")
    .find({ corporationId: cid })
    .sort({ turn: -1 })
    .limit(30)
    .toArray();
  for (const t of trades) {
    console.log(
      `t${t.turn} ${t.type || t.tradeType} from=${t.fromName || t.from} to=${t.toName || t.to} sh=${M(t.shares)} px=${M(t.pricePerShare ?? t.price)} tot=${M(t.totalValue ?? t.total)}`
    );
  }
} finally {
  await client.close();
}

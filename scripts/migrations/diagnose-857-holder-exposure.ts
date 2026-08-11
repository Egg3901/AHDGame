/**
 * READ-ONLY. Sizes real-player (character/imperial) vs NPP exposure to the #857
 * currency-scale windfall, per non-USD fund. For each fund: units by holder class,
 * and the top real-player positions with their implied native windfall
 * (redeem payout at quotedNav×rate  vs  what they paid ≈ avgNavAnchor as native).
 */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI not set");
const fmt = (n: number) =>
  Math.abs(n) >= 1e9
    ? (n / 1e9).toFixed(2) + "B"
    : Math.abs(n) >= 1e6
      ? (n / 1e6).toFixed(2) + "M"
      : Math.round(n).toLocaleString();

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db();

  const rates = new Map<string, number>();
  for (const r of await db.collection("exchangeRates").find({}).toArray())
    if (typeof r.currencyCode === "string") rates.set(r.currencyCode, r.rate);

  const funds = await db.collection("indexFunds").find({}).toArray();
  for (const f of funds) {
    const ccy = f.anchorCurrencyCode as string;
    const rate = rates.get(ccy) ?? 1;
    if (Math.abs(rate - 1) < 0.02) continue; // skip ~unaffected (USD-ish)

    const positions = await db
      .collection("indexFundPositions")
      .find({ fundId: f._id, units: { $gt: 0 } })
      .toArray();
    const byClass: Record<string, { units: number; n: number }> = {};
    for (const p of positions) {
      const k = p.holderKind as string;
      byClass[k] = byClass[k] || { units: 0, n: 0 };
      byClass[k].units += p.units;
      byClass[k].n += 1;
    }
    const realPos = positions
      .filter((p) => p.holderKind === "character" || p.holderKind === "imperial_character")
      .sort((a, b) => b.units - a.units)
      .slice(0, 4);

    console.log(
      `\n${f.slug}  (${ccy}, rate=${rate.toFixed(2)}, quotedNav=${(f.quotedNav as number).toFixed(1)}, units=${fmt(f.unitSupply)})`
    );
    console.log(
      "  by holder class:",
      Object.entries(byClass)
        .map(([k, v]) => `${k}=${fmt(v.units)}u/${v.n}`)
        .join("  ")
    );
    if (realPos.length) {
      for (const p of realPos) {
        const paidNative = (p.avgNavAnchor ?? f.quotedNav) * p.units; // buggy: anchor magnitude spent as native
        const redeemNative = (f.quotedNav as number) * rate * p.units; // fixed payout
        console.log(
          `    REAL ${p.holderKind} char=${p.characterId ?? p.imperialCharacterId} units=${fmt(p.units)} avgNav=${(p.avgNavAnchor ?? 0).toFixed(2)} ` +
            `→ paid≈${fmt(paidNative)} ${ccy}, redeem≈${fmt(redeemNative)} ${ccy}, windfall≈${fmt(redeemNative - paidNative)} ${ccy}`
        );
      }
    } else {
      console.log("    (no real-player positions — NPP/reserve only)");
    }
  }
  await client.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { loadFederalBudgetDetail } from "@/lib/publicFinance/queries/federalBudgetDetail";

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db("a-house-divided");

  try {
    console.log("Testing loadFederalBudgetDetail for CN...");
    const result = await loadFederalBudgetDetail({
      db: db as any,
      countryId: "CN" as any,
      requestUrl: "http://localhost:3000/api/country/cn/budget/federal",
    });

    if (result.ok) {
      console.log("SUCCESS! ok=true");
      console.log("  budget.countryId:", (result.body as any).budget?.countryId);
      console.log("  budget.revenue.total:", (result.body as any).budget?.revenue?.total);
      console.log("  budget.spending.total:", (result.body as any).budget?.spending?.total);
      console.log("  primeRate:", (result.body as any).primeRate);
      console.log("  stateGrantBreakdown count:", (result.body as any).stateGrantBreakdown?.length);
      console.log("  enactedLaws count:", (result.body as any).enactedLaws?.length);
    } else {
      console.log("FAILED! ok=false");
      console.log("  status:", result.status);
      console.log("  error:", result.error);
    }
  } catch (e: any) {
    console.error("EXCEPTION:", e.message);
    console.error(e.stack);
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

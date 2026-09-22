import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
import { getDb } from "@/lib/mongodb";
import { buildCountryReadinessReport } from "@/lib/admin/countryReadinessReport";

async function main() {
  const db = await getDb();
  for (const c of ["US", "UK", "JP", "DE", "CN"] as const) {
    const r = await buildCountryReadinessReport(db, c);
    if (!r) {
      console.log(`${c}: no expectations`);
      continue;
    }
    const bad = (r.checks ?? []).filter((x) => x.status !== "ok");
    console.log(`\n${c}: ${bad.length} non-ok of ${(r.checks ?? []).length}`);
    for (const x of bad)
      console.log(`   ${x.status.padEnd(8)} ${x.name.padEnd(18)} ${x.detail ?? ""}`);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
